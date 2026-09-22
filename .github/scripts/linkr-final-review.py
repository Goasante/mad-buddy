from pathlib import Path

def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected snippet missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# Canonical Linkr candidate ranking: private, decaying reciprocity nudge.
path = "lib/linkr/candidate-service.ts"
replace_once(
    path,
    'export const CANDIDATE_PAGE_SIZE = 20;\n',
    '''export const CANDIDATE_PAGE_SIZE = 20;

/**
 * Private reciprocity is a NUDGE, never an eligibility rule. Six points is
 * useful inside an otherwise close ranking, but smaller than the base gap
 * from close -> near (12) and near -> far (10). The signal decays to zero so
 * an old one-sided click cannot permanently pin somebody near the front.
 */
const PRIVATE_RECIPROCITY_BOOST_MAX = 6;
const PRIVATE_RECIPROCITY_BOOST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function privateReciprocityBoost(updatedAt: string | undefined, nowMs: number): number {
  if (!updatedAt) return 0;
  const ageMs = nowMs - Date.parse(updatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= PRIVATE_RECIPROCITY_BOOST_WINDOW_MS) return 0;
  return PRIVATE_RECIPROCITY_BOOST_MAX * (1 - ageMs / PRIVATE_RECIPROCITY_BOOST_WINDOW_MS);
}
'''
)
replace_once(
    path,
    '''    { data: actions },
    { data: connections },
    photosByUser,''',
    '''    { data: actions },
    { data: inboundConnects },
    { data: connections },
    photosByUser,'''
)
replace_once(
    path,
    '''    admin
      .from("linkr_actions")
      .select("target_id, action, expires_at")
      .eq("actor_id", viewerId)
      .in("target_id", candidateIds),
    admin
      .from("linkr_connections")''',
    '''    admin
      .from("linkr_actions")
      .select("target_id, action, expires_at")
      .eq("actor_id", viewerId)
      .in("target_id", candidateIds),
    // Incoming one-sided Connects are used only as a server-side ordering
    // hint. Actor ids/timestamps never enter the response shape, and no count,
    // badge, or "liked you" state is exposed to the viewer.
    admin
      .from("linkr_actions")
      .select("actor_id, updated_at")
      .eq("target_id", viewerId)
      .eq("action", "connect")
      .in("actor_id", candidateIds),
    admin
      .from("linkr_connections")'''
)
replace_once(
    path,
    '''  const actedOnIds = new Set(
    (actions ?? [])
      .filter((row) => !row.expires_at || Date.parse(row.expires_at) > nowMs)
      .map((row) => row.target_id)
  );

  const profileByUserId''',
    '''  const actedOnIds = new Set(
    (actions ?? [])
      .filter((row) => !row.expires_at || Date.parse(row.expires_at) > nowMs)
      .map((row) => row.target_id)
  );
  const inboundConnectAt = new Map(
    (inboundConnects ?? []).map((row) => [row.actor_id, row.updated_at])
  );

  const profileByUserId'''
)
replace_once(
    path,
    '''        joinedRecently: Date.parse(row.created_at) > dayAgoMs
      }),
      candidate: {''',
    '''        joinedRecently: Date.parse(row.created_at) > dayAgoMs
      }) + privateReciprocityBoost(inboundConnectAt.get(id), nowMs),
      candidate: {'''
)

# Canonical Linkr rewind policy.
path = "lib/linkr/connection-service.ts"
replace_once(
    path,
    'export const UNDO_WINDOW_MS = 5 * 60 * 1000;\n',
    'export const UNDO_WINDOW_MS = 5 * 60 * 1000;\nconst DAILY_SELF_SERVICE_PASS_REWINDS = 3;\n'
)
undo_marker = '''/**
 * Undo the most recent decision, within a short window.
 *
 * DELIBERATELY REFUSES once a connection exists. Undo is for "I tapped the'''
helper = '''async function requestPassReversalReview(
  admin: Admin,
  viewerId: string,
  targetId: string,
  passExpiresAt: string
): Promise<string> {
  // Dedupe before consuming the support-request limiter. Repeated taps on the
  // same exhausted rewind must not create a queue of identical tickets.
  const { data: openTickets } = await admin
    .from("support_tickets")
    .select("id, diagnostics, status")
    .eq("user_id", viewerId)
    .eq("category", "muddies")
    .not("status", "in", "(resolved,closed)")
    .order("created_at", { ascending: false })
    .limit(20);

  const alreadyOpen = (openTickets ?? []).some((ticket) => {
    const diagnostics = ticket.diagnostics;
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return false;
    const record = diagnostics as Record<string, unknown>;
    return record.workflow === "linkr_pass_reversal" && record.target_user_id === targetId;
  });
  if (alreadyOpen) {
    return "You've used today's 3 Linkr rewinds. This pass is already waiting for Mad Buddy support review.";
  }

  const supportLimit = await consumeRateLimit({ action: "support.request", userId: viewerId });
  if (!supportLimit.allowed) {
    return `You've used today's 3 Linkr rewinds. ${rateLimitMessage(supportLimit.resetAt)}`;
  }

  const { error } = await admin.from("support_tickets").insert({
    user_id: viewerId,
    category: "muddies",
    subject: "Linkr rewind request",
    description: "I used my three self-service Linkr rewinds and want to restore the most recent profile I passed.",
    priority: "normal",
    status: "new",
    diagnostics: {
      affected_feature: "linkr",
      workflow: "linkr_pass_reversal",
      target_user_id: targetId,
      pass_expires_at: passExpiresAt,
      source: "linkr_v2"
    } as never
  });

  return error
    ? "You've used today's 3 Linkr rewinds. Support review could not be requested just now — try again."
    : "You've used today's 3 Linkr rewinds. This pass was sent to Mad Buddy support for review.";
}

'''
replace_once(path, undo_marker, helper + undo_marker)
replace_once(
    path,
    '.select("id, target_id, action, created_at, updated_at")',
    '.select("id, target_id, action, expires_at, created_at, updated_at")'
)
replace_once(
    path,
    '''  const { error } = await admin.from("linkr_actions").delete().eq("id", last.id).eq("actor_id", viewerId);
  if (error) return { ok: false, message: "Couldn't undo that. Try again." };
  return { ok: true, message: "Undone.", restoredUserId: last.target_id };''',
    '''  let rewindRemaining: number | null = null;
  const ordinaryExpiringPass = last.action === "pass" && Boolean(last.expires_at);
  if (ordinaryExpiringPass) {
    const rewind = await consumeRateLimit({ action: "linkr.undo", userId: viewerId });
    if (!rewind.allowed) {
      return {
        ok: false,
        message: await requestPassReversalReview(
          admin,
          viewerId,
          last.target_id,
          last.expires_at as string
        )
      };
    }
    rewindRemaining = rewind.remaining;
  }

  const { error } = await admin.from("linkr_actions").delete().eq("id", last.id).eq("actor_id", viewerId);
  if (error) return { ok: false, message: "Couldn't undo that. Try again." };

  if (rewindRemaining === null) {
    return { ok: true, message: "Undone.", restoredUserId: last.target_id };
  }
  return {
    ok: true,
    message:
      rewindRemaining === 0
        ? `Undone. You've used all ${DAILY_SELF_SERVICE_PASS_REWINDS} self-service Linkr rewinds for today.`
        : `Undone. ${rewindRemaining} Linkr ${rewindRemaining === 1 ? "rewind" : "rewinds"} left today.`,
    restoredUserId: last.target_id
  };'''
)

# Canonical admin review.
admin_action = r'''"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isBlockedEitherDirection } from "@/lib/social/permissions";

export type LinkrReversalReviewState = { ok: boolean; message: string };

const reviewSchema = z.object({
  ticketId: z.string().uuid(),
  decision: z.enum(["approve", "reject"])
});

function diagnosticsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function reviewLinkrPassReversalAction(input: unknown): Promise<LinkrReversalReviewState> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That rewind request could not be identified." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .select("id, user_id, status, diagnostics")
      .eq("id", parsed.data.ticketId)
      .maybeSingle();

    if (ticketError || !ticket?.user_id) return { ok: false, message: "That support request is no longer available." };
    if (ticket.status === "resolved" || ticket.status === "closed") {
      return { ok: false, message: "This rewind request has already been reviewed." };
    }

    const diagnostics = diagnosticsObject(ticket.diagnostics);
    const targetUserId = typeof diagnostics.target_user_id === "string" ? diagnostics.target_user_id : "";
    if (diagnostics.workflow !== "linkr_pass_reversal" || !z.string().uuid().safeParse(targetUserId).success) {
      return { ok: false, message: "This support issue is not a Linkr rewind request." };
    }

    const approved = parsed.data.decision === "approve";
    let activePassId: string | null = null;

    if (approved) {
      // Safety always outranks recovery. Admin cannot use a rewind ticket to
      // route around a block that either person placed after the pass.
      if (await isBlockedEitherDirection(admin, ticket.user_id, targetUserId)) {
        return { ok: false, message: "This profile cannot be restored while a block is active." };
      }

      const { data: pass, error: passError } = await admin
        .from("linkr_actions")
        .select("id, expires_at")
        .eq("actor_id", ticket.user_id)
        .eq("target_id", targetUserId)
        .eq("action", "pass")
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (passError) return { ok: false, message: "The current Linkr pass could not be verified." };
      activePassId = pass?.id ?? null;
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: approved ? "linkr_pass_reversal_approved" : "linkr_pass_reversal_rejected",
      targetType: "support_ticket",
      targetId: ticket.id,
      newState: { targetUserId, decision: parsed.data.decision, activePass: Boolean(activePassId) },
      reason: "Admin review of canonical Linkr rewind request"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

    if (approved && activePassId) {
      const { error: deleteError } = await admin
        .from("linkr_actions")
        .delete()
        .eq("id", activePassId)
        .eq("actor_id", ticket.user_id)
        .eq("action", "pass");
      if (deleteError) return { ok: false, message: "The Linkr pass could not be restored." };
    }

    const resolvedAt = new Date().toISOString();
    const { error: ticketUpdateError } = await admin
      .from("support_tickets")
      .update({ status: "resolved", resolved_at: resolvedAt })
      .eq("id", ticket.id);
    if (ticketUpdateError) return { ok: false, message: "The review was applied, but the support issue could not be closed." };

    await admin.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: context.userId,
      event_type: "status_changed",
      from_value: ticket.status,
      to_value: "resolved",
      note: approved ? "Linkr rewind approved" : "Linkr rewind rejected"
    });

    await deliverNotification(admin, {
      userId: ticket.user_id,
      type: "system_alert",
      title: approved ? "Your Linkr rewind was approved" : "Your Linkr rewind was reviewed",
      message: approved
        ? activePassId
          ? "That passed profile is eligible to appear in Linkr again. No connection was created automatically."
          : "That pass had already expired or been cleared, so the profile was already eligible to appear again."
        : "The pass stays in place for now and will still expire automatically after its normal 30-day window."
    });

    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${ticket.id}`);
    return {
      ok: true,
      message: approved
        ? activePassId
          ? "Linkr rewind approved and the pass was removed."
          : "Linkr rewind approved; the pass was already inactive."
        : "Linkr rewind request rejected."
    };
  } catch {
    return { ok: false, message: "Admin access is required to review Linkr rewinds." };
  }
}
'''
Path("app/(admin)/admin/support/linkr-reversal-actions.ts").write_text(admin_action)

replace_once(
    "app/(admin)/admin/support/[issueId]/page.tsx",
    '''      admin
        .from("discovery_passes")
        .select("expires_at")
        .eq("user_id", ticket.user_id)
        .eq("passed_user_id", linkrTargetUserId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),''',
    '''      admin
        .from("linkr_actions")
        .select("expires_at")
        .eq("actor_id", ticket.user_id)
        .eq("target_id", linkrTargetUserId)
        .eq("action", "pass")
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),'''
)
replace_once(
    "components/admin/support/linkr-reversal-review.tsx",
    "Approval only removes the temporary pass; it never creates a connection or reveals whether the other person showed interest.",
    "Approval only removes the canonical temporary Linkr pass; it never creates a connection, a Muddy friendship, or reveals whether the other person clicked."
)

test_file = r'''import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("final Linkr architecture review", () => {
  it("keeps the canonical 30-day pass and three-per-day rewind policy", () => {
    const service = read("lib/linkr/connection-service.ts");
    expect(service).toContain("PASS_DURATION_MS = 30 * 24 * 60 * 60 * 1000");
    expect(service).toContain('consumeRateLimit({ action: "linkr.undo"');
    expect(service).toContain("DAILY_SELF_SERVICE_PASS_REWINDS = 3");
    expect(service).toContain('workflow: "linkr_pass_reversal"');
  });

  it("uses incoming one-sided Connect only as a server-side decaying ranking nudge", () => {
    const candidates = read("lib/linkr/candidate-service.ts");
    expect(candidates).toContain('.eq("target_id", viewerId)');
    expect(candidates).toContain('.eq("action", "connect")');
    expect(candidates).toContain("privateReciprocityBoost(inboundConnectAt.get(id), nowMs)");
    expect(candidates).toContain("PRIVATE_RECIPROCITY_BOOST_MAX = 6");
    const typeBlock = candidates.slice(
      candidates.indexOf("export type LinkrCandidate"),
      candidates.indexOf("function serverReady")
    );
    expect(typeBlock).not.toContain("reciprocity");
    expect(typeBlock).not.toContain("clickedYou");
  });

  it("keeps Linkr matches separate from Muddy friendships", () => {
    const service = read("lib/linkr/connection-service.ts");
    const foundation = read("supabase/migrations/20260818130000_linkr_2_foundation.sql");
    expect(service).not.toContain('.from("friendships")');
    expect(foundation).toContain("This is NOT a friendship");
  });

  it("makes admin rewind review act on canonical linkr_actions only", () => {
    const admin = read("app/(admin)/admin/support/linkr-reversal-actions.ts");
    expect(admin).toContain('.from("linkr_actions")');
    expect(admin).not.toContain('from("discovery_passes")');
    expect(admin).not.toContain('from("friend_requests")');
    expect(admin).toContain("isBlockedEitherDirection");
  });

  it("does not route old Socialize through a second Linkr authority", () => {
    const web = read("app/(app)/actions.ts");
    const api = read("app/api/friends/request/route.ts");
    const friends = read("lib/friends/service.ts");
    const socialize = read("lib/social/socialize-mobile.ts");
    expect(web).not.toContain("sendLinkrInterest");
    expect(api).not.toContain("sendLinkrInterest");
    expect(friends).not.toContain("context_type.neq.socialize");
    expect(socialize).not.toContain("inboundLinkrInterestBoost");
  });
});
'''
Path("lib/linkr/final-architecture-review.test.ts").write_text(test_file)
