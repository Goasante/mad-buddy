"use server";

import { z } from "zod";
import {
  MAX_CONTACTS_PER_MATCH,
  normalizeEmail,
  normalizePhone,
  protectIdentifier,
  protectIdentifierBatch
} from "@/lib/discovery/contacts";
import {
  createPersonalQrToken,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryMs,
  resolveInviteRedemption,
  shortCodeFromToken,
  verifyPersonalQrToken
} from "@/lib/discovery/invites";
import { guardAction, guardFeature } from "@/lib/admin/enforcement";
import { contactPepper, qrSecret, resolvePairState } from "@/lib/discovery/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { InviteType } from "@/lib/supabase/database.types";

export type InviteActionState = {
  ok: boolean;
  message: string;
  inviteId?: string;
  /** Raw token, returned once at creation and never stored (spec §26). */
  token?: string;
  url?: string;
};

export type InvitePreview = {
  inviterName: string;
  inviterAvatarUrl: string | null;
  inviteType: string;
  expiresAt: string;
  valid: boolean;
  reason: string;
};

export type PersonalQr = { token: string; shortCode: string; rotatesInSeconds: number };

export type ContactMatch = { userId: string; displayName: string; username: string; avatarUrl: string | null };

const uuidSchema = z.string().uuid();

function missingEnvState(): InviteActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

// ---------------------------------------------------------------------------
// Invite links (spec §21-§27)
// ---------------------------------------------------------------------------

const createInviteSchema = z.object({
  inviteType: z.enum(["personal", "event", "circle", "community"]),
  contextId: uuidSchema.optional(),
  maxUses: z.number().int().min(1).max(100).optional()
});

export async function createInviteAction(input: unknown): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the invite details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "invites.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId, surface: "invite_links", control: "invite_links" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const token = generateInviteToken();
  const { data: invite, error } = await admin
    .from("invite_links")
    .insert({
      creator_id: userId,
      invite_type: parsed.data.inviteType as InviteType,
      context_id: parsed.data.contextId ?? null,
      // Only the hash is persisted, a DB leak yields no usable links (§26).
      token_hash: hashInviteToken(token),
      delivery_type: "link",
      status: "active",
      max_uses: parsed.data.maxUses ?? 1,
      expires_at: new Date(Date.now() + inviteExpiryMs(parsed.data.inviteType)).toISOString()
    })
    .select("id")
    .single();
  if (error || !invite) return { ok: false, message: "Couldn't create that invite." };

  return {
    ok: true,
    message: "Invite link ready.",
    inviteId: invite.id,
    token,
    url: `/invite/${token}`
  };
}

/** Pre-login preview: inviter identity and purpose only (spec §25). */
export async function resolveInviteAction(token: string): Promise<InvitePreview | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey || !token) return null;

  const admin = createSupabaseAdminClient();
  const { data: invite } = await admin
    .from("invite_links")
    .select("id, creator_id, invite_type, status, expires_at, revoked_at, uses_count, max_uses")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!invite) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("user_id", invite.creator_id)
    .maybeSingle();

  const nowMs = Date.now();
  const usable =
    invite.status === "active" &&
    !invite.revoked_at &&
    Date.parse(invite.expires_at) > nowMs &&
    invite.uses_count < invite.max_uses;

  // Never expose the creator's private data, name and avatar only (§25).
  return {
    inviterName: profile?.full_name?.trim() || "A Muddy",
    inviterAvatarUrl: profile?.avatar_url ?? null,
    inviteType: invite.invite_type,
    expiresAt: invite.expires_at,
    valid: usable,
    reason: usable ? "valid" : "unavailable"
  };
}

export async function acceptInviteAction(token: string): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!token) return { ok: false, message: "That invite link isn't valid." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in to accept this invite." };

  const rateLimit = await consumeRateLimit({ action: "invites.resolve", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data: invite } = await admin
    .from("invite_links")
    .select("id, creator_id, invite_type, status, expires_at, revoked_at, uses_count, max_uses")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!invite) return { ok: false, message: "That invite link isn't valid." };

  const pair = await resolvePairState(admin, invite.creator_id, userId);
  const decision = resolveInviteRedemption({
    status: invite.status,
    inviteType: invite.invite_type,
    requestedType: "personal",
    expiresAtMs: Date.parse(invite.expires_at),
    revokedAtMs: invite.revoked_at ? Date.parse(invite.revoked_at) : null,
    usesCount: invite.uses_count,
    maxUses: invite.max_uses,
    nowMs: Date.now(),
    creatorId: invite.creator_id,
    redeemerId: userId,
    alreadyFriends: pair.alreadyFriends,
    isBlockedEitherDirection: pair.isBlockedEitherDirection
  });

  if (!decision.allowed) {
    // Already Muddies isn't a failure, just nothing to do (spec §64).
    if (decision.reason === "already_friends") {
      return { ok: true, message: "You're already Muddies." };
    }
    const messages: Record<string, string> = {
      expired: "That invite link has expired.",
      revoked: "That invite link was revoked.",
      used_up: "That invite link has already been used.",
      purpose_mismatch: "That link isn't a personal invite.",
      self: "That's your own invite link.",
      blocked: "That invite link isn't available.",
      not_active: "That invite link isn't available."
    };
    return { ok: false, message: messages[decision.reason] ?? "That invite link isn't available." };
  }

  // Accepting an invite creates a REQUEST, not an instant friendship: the
  // inviter chose to invite, but consent still runs both ways (spec §21).
  const created = await createPendingRequest(admin, userId, invite.creator_id);
  if (!created) return { ok: false, message: "Couldn't accept that invite." };

  await admin
    .from("invite_links")
    .update({
      uses_count: invite.uses_count + 1,
      status: invite.uses_count + 1 >= invite.max_uses ? "used" : "active",
      updated_at: new Date().toISOString()
    })
    .eq("id", invite.id);

  return { ok: true, message: "Request sent. They'll see it shortly." };
}

export async function revokeInviteAction(inviteId: string): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(inviteId).success) return { ok: false, message: "Invite not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("invite_links")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("creator_id", userId);
  if (error) return { ok: false, message: "Couldn't revoke that invite." };
  return { ok: true, message: "Invite revoked. The link no longer works." };
}

// ---------------------------------------------------------------------------
// Personal QR (spec §32, §33, §35)
// ---------------------------------------------------------------------------

export async function getPersonalQrAction(): Promise<PersonalQr | null> {
  const userId = await getAuthedUserId();
  const secret = qrSecret();
  if (!userId || !secret) return null;

  const nowMs = Date.now();
  const token = createPersonalQrToken(userId, secret, nowMs);
  const { QR_WINDOW_MS } = await import("@/lib/discovery/invites");
  return {
    token,
    shortCode: shortCodeFromToken(token),
    rotatesInSeconds: Math.ceil((QR_WINDOW_MS - (nowMs % QR_WINDOW_MS)) / 1000)
  };
}

/** Scanning shows a preview and creates a REQUEST, never an auto-friendship. */
export async function scanPersonalQrAction(token: string): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const secret = qrSecret();
  if (!secret) return { ok: false, message: "QR scanning isn't available right now." };

  const rateLimit = await consumeRateLimit({ action: "invites.resolve", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const verified = verifyPersonalQrToken(token, secret, Date.now());
  if (!verified.valid) {
    return {
      ok: false,
      message: verified.reason === "expired" ? "That code has expired. Ask for a fresh one." : "That code isn't valid."
    };
  }
  if (verified.userId === userId) return { ok: false, message: "That's your own code." };

  const admin = createSupabaseAdminClient();
  const pair = await resolvePairState(admin, verified.userId, userId);
  if (pair.isBlockedEitherDirection) return { ok: false, message: "That code isn't available." };
  if (pair.alreadyFriends) return { ok: true, message: "You're already Muddies." };
  if (pair.hasPendingOutgoing) return { ok: true, message: "You've already sent them a request." };

  const created = await createPendingRequest(admin, userId, verified.userId);
  if (!created) return { ok: false, message: "Couldn't send that request." };
  return { ok: true, message: "Request sent." };
}

/**
 * Inserts a pending friend request. The partial unique index
 * (sender_id, receiver_id) WHERE status='pending' makes a concurrent duplicate
 * a constraint violation rather than a second row, we treat that as success,
 * since the user's intent (a request exists) is satisfied either way.
 */
async function createPendingRequest(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  senderId: string,
  receiverId: string
): Promise<boolean> {
  const { error } = await admin.from("friend_requests").insert({
    sender_id: senderId,
    receiver_id: receiverId,
    status: "pending",
    context_type: "friend",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  if (!error) return true;

  const { data: existing } = await admin
    .from("friend_requests")
    .select("id")
    .eq("sender_id", senderId)
    .eq("receiver_id", receiverId)
    .eq("status", "pending")
    .maybeSingle();
  return Boolean(existing);
}

// ---------------------------------------------------------------------------
// Contact matching (spec §40-§48)
// ---------------------------------------------------------------------------

const contactMatchSchema = z.object({
  phones: z.array(z.string().max(40)).max(MAX_CONTACTS_PER_MATCH).optional(),
  emails: z.array(z.string().max(200)).max(MAX_CONTACTS_PER_MATCH).optional(),
  defaultCountryCode: z.string().max(5).optional()
});

/**
 * Matches contacts against opted-in accounts. Raw identifiers are normalized
 * and hashed in-request and NEVER persisted, only session counts are stored
 * (spec §41). Returns matches only; it never reveals which contacts are absent.
 */
export async function matchContactsAction(input: unknown): Promise<{ matches: ContactMatch[]; message: string }> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { matches: [], message: "Contact matching isn't available." };

  const parsed = contactMatchSchema.safeParse(input);
  if (!parsed.success) return { matches: [], message: "Check your contacts and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { matches: [], message: "Log in first." };

  const pepper = contactPepper();
  if (!pepper) return { matches: [], message: "Contact matching isn't available." };

  const rateLimit = await consumeRateLimit({ action: "contacts.match", userId });
  if (!rateLimit.allowed) return { matches: [], message: rateLimitMessage(rateLimit.resetAt) };

  // Contact matching has its own kill switch (batch 13 §62), it processes
  // personal identifiers, so it must be stoppable without a deploy.
  const guard = await guardFeature(createSupabaseAdminClient(), "contact_matching");
  if (!guard.allowed) return { matches: [], message: guard.message };

  const country = parsed.data.defaultCountryCode || "233";
  const normalizedPhones = (parsed.data.phones ?? [])
    .map((phone) => normalizePhone(phone, country))
    .filter((value): value is string => Boolean(value));
  const normalizedEmails = (parsed.data.emails ?? [])
    .map((email) => normalizeEmail(email))
    .filter((value): value is string => Boolean(value));

  const submittedCount = normalizedPhones.length + normalizedEmails.length;
  if (submittedCount === 0) return { matches: [], message: "No usable contacts to match." };

  const admin = createSupabaseAdminClient();
  const phoneHashes = protectIdentifierBatch({ identifiers: normalizedPhones, pepper });
  const emailHashes = protectIdentifierBatch({ identifiers: normalizedEmails, pepper });

  const matchedUserIds = new Set<string>();
  for (const [type, hashes] of [
    ["phone", phoneHashes],
    ["email", emailHashes]
  ] as const) {
    if (hashes.length === 0) continue;
    // Only opted-in identifiers are ever consulted (spec §5, §41).
    const { data } = await admin
      .from("discoverability_identifiers")
      .select("user_id")
      .eq("identifier_type", type)
      .eq("is_discoverable", true)
      .in("protected_identifier", hashes);
    for (const row of data ?? []) matchedUserIds.add(row.user_id);
  }
  matchedUserIds.delete(userId);

  if (matchedUserIds.size === 0) {
    await recordSession(admin, userId, submittedCount, 0);
    return { matches: [], message: "No contacts found on Mad Buddy yet." };
  }

  const { data: blocks } = await admin
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  for (const block of blocks ?? []) {
    matchedUserIds.delete(block.blocker_id);
    matchedUserIds.delete(block.blocked_id);
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, deleted_at")
    .in("user_id", [...matchedUserIds]);

  const matches: ContactMatch[] = (profiles ?? [])
    .filter((profile) => !profile.deleted_at)
    .map((profile) => ({
      userId: profile.user_id,
      displayName: profile.full_name?.trim() || "A Muddy",
      username: profile.username,
      avatarUrl: profile.avatar_url
    }));

  await recordSession(admin, userId, submittedCount, matches.length);
  return { matches, message: `Found ${matches.length} on Mad Buddy.` };
}

async function recordSession(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submitted: number,
  matched: number
) {
  // Counts only, the uploaded identifiers themselves are never stored.
  await admin.from("contact_match_sessions").insert({
    user_id: userId,
    status: "completed",
    submitted_count: submitted,
    matched_count: matched,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
}

/** Opt in/out of being found by phone or email (spec §45). */
export async function setDiscoverabilityAction(
  identifierType: "phone" | "email",
  rawValue: string | null,
  isDiscoverable: boolean
): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const pepper = contactPepper();
  if (!pepper) return { ok: false, message: "That setting isn't available right now." };

  const admin = createSupabaseAdminClient();

  // Turning it off removes the identifier entirely (spec §45: delete data).
  if (!isDiscoverable || !rawValue) {
    await admin
      .from("discoverability_identifiers")
      .delete()
      .eq("user_id", userId)
      .eq("identifier_type", identifierType);
    return { ok: true, message: "You won't be found this way. Your data was removed." };
  }

  const normalized =
    identifierType === "phone" ? normalizePhone(rawValue, "233") : normalizeEmail(rawValue);
  if (!normalized) return { ok: false, message: "That doesn't look right. Check and try again." };

  const { error } = await admin.from("discoverability_identifiers").upsert(
    {
      user_id: userId,
      identifier_type: identifierType,
      protected_identifier: protectIdentifier(normalized, pepper),
      is_discoverable: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,identifier_type" }
  );
  if (error) return { ok: false, message: "Couldn't save that setting." };
  return { ok: true, message: "Saved. Only your Muddies' contacts can match you." };
}

/** Deletes all contact-matching data for this user (spec §45). */
export async function deleteContactMatchDataAction(): Promise<InviteActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await Promise.all([
    admin.from("discoverability_identifiers").delete().eq("user_id", userId),
    admin
      .from("contact_match_sessions")
      .update({ status: "deleted", deleted_at: new Date().toISOString() })
      .eq("user_id", userId)
  ]);
  return { ok: true, message: "Contact matching data deleted." };
}
