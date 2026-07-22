import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { errorType, logBackendEvent } from "@/lib/observability/logger";

export type RateLimitAction =
  | "auth.signup"
  | "auth.login"
  | "auth.password_recovery"
  | "auth.password_reset"
  | "friends.search"
  | "friends.request"
  | "location.update"
  | "friends.nearby"
  | "reports.create"
  | "paystack.initialize"
  | "paystack.webhook"
  | "waves.send"
  | "waves.send.daily"
  | "pings.create"
  | "pings.create.daily"
  | "status.update"
  | "plans.create"
  | "plans.invite"
  | "hangouts.start"
  | "hangouts.request"
  | "safe_arrival.create"
  | "events.create"
  | "checkins.create"
  | "event_circles.join"
  | "event_announcements.send"
  | "moments.create"
  | "moments.react"
  | "drops.create"
  | "drops.unlock"
  | "media.upload"
  | "content.report"
  | "messages.send"
  | "conversations.create"
  | "groups.create"
  | "invites.create"
  | "invites.resolve"
  | "contacts.match"
  | "verify.phone"
  | "feedback.submit"
  | "support.request"
  | "notifications.mutate"
  | "account.export"
  | "account.delete"
  | "admin.mutate"
  | "admin.password_reset"
  | "admin.search";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export const rateLimitRules: Record<RateLimitAction, { limit: number; windowSeconds: number }> = {
  "auth.signup": { limit: 5, windowSeconds: 15 * 60 },
  "auth.login": { limit: 10, windowSeconds: 15 * 60 },
  "auth.password_recovery": { limit: 5, windowSeconds: 60 * 60 },
  "auth.password_reset": { limit: 5, windowSeconds: 60 * 60 },
  "friends.search": { limit: 30, windowSeconds: 60 },
  "friends.request": { limit: 10, windowSeconds: 24 * 60 * 60 },
  "location.update": { limit: 60, windowSeconds: 60 },
  "friends.nearby": { limit: 60, windowSeconds: 60 },
  "reports.create": { limit: 5, windowSeconds: 60 * 60 },
  "paystack.initialize": { limit: 5, windowSeconds: 15 * 60 },
  "paystack.webhook": { limit: 1200, windowSeconds: 60 },
  // Wave/Ping anti-spam (feature spec §20, §41).
  "waves.send": { limit: 20, windowSeconds: 60 * 60 },
  "waves.send.daily": { limit: 50, windowSeconds: 24 * 60 * 60 },
  "pings.create": { limit: 10, windowSeconds: 60 * 60 },
  "pings.create.daily": { limit: 25, windowSeconds: 24 * 60 * 60 },
  "status.update": { limit: 30, windowSeconds: 60 * 60 },
  // Plans / Hangout anti-spam (feature spec §55, §10).
  "plans.create": { limit: 20, windowSeconds: 60 * 60 },
  "plans.invite": { limit: 100, windowSeconds: 60 * 60 },
  "hangouts.start": { limit: 10, windowSeconds: 60 * 60 },
  "hangouts.request": { limit: 40, windowSeconds: 60 * 60 },
  // Safe Arrival / event anti-abuse (feature spec §17, §30, §56).
  "safe_arrival.create": { limit: 10, windowSeconds: 60 * 60 },
  "events.create": { limit: 10, windowSeconds: 24 * 60 * 60 },
  "checkins.create": { limit: 20, windowSeconds: 60 * 60 },
  "event_circles.join": { limit: 20, windowSeconds: 60 * 60 },
  "event_announcements.send": { limit: 10, windowSeconds: 60 * 60 },
  // Moments/Drops/media anti-spam (feature spec §16, §32, §54). Reporting is
  // deliberately generous, never rate-limit a user out of safety tools (§16).
  "moments.create": { limit: 25, windowSeconds: 24 * 60 * 60 },
  "moments.react": { limit: 120, windowSeconds: 60 * 60 },
  "drops.create": { limit: 25, windowSeconds: 24 * 60 * 60 },
  "drops.unlock": { limit: 60, windowSeconds: 60 * 60 },
  "media.upload": { limit: 40, windowSeconds: 60 * 60 },
  "content.report": { limit: 60, windowSeconds: 60 * 60 },
  // Messaging (feature spec §8): generous enough not to damage normal
  // conversations, 30/minute is the documented cap.
  "messages.send": { limit: 30, windowSeconds: 60 },
  "conversations.create": { limit: 30, windowSeconds: 60 * 60 },
  "groups.create": { limit: 10, windowSeconds: 24 * 60 * 60 },
  // Discovery / invites (feature spec §23, §37, §56). Tight on resolve to make
  // token guessing and QR scraping impractical.
  "invites.create": { limit: 20, windowSeconds: 60 * 60 },
  "invites.resolve": { limit: 30, windowSeconds: 10 * 60 },
  "contacts.match": { limit: 5, windowSeconds: 24 * 60 * 60 },
  "verify.phone": { limit: 5, windowSeconds: 60 * 60 },
  "feedback.submit": { limit: 5, windowSeconds: 60 * 60 },
  "support.request": { limit: 5, windowSeconds: 60 * 60 },
  "notifications.mutate": { limit: 120, windowSeconds: 60 * 60 },
  "account.export": { limit: 3, windowSeconds: 60 * 60 },
  "account.delete": { limit: 3, windowSeconds: 24 * 60 * 60 },
  "admin.mutate": { limit: 120, windowSeconds: 60 * 60 },
  "admin.password_reset": { limit: 10, windowSeconds: 60 * 60 },
  "admin.search": { limit: 120, windowSeconds: 60 }
};

function hashIp(value: string | null) {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex");
}

function ipFromHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getClientIpHashFromRequest(request: Request) {
  return hashIp(
    ipFromHeaderValue(request.headers.get("x-forwarded-for")) ??
      request.headers.get("x-real-ip") ??
      request.headers.get("cf-connecting-ip")
  );
}

export async function getClientIpHashFromHeaders() {
  const headerStore = await headers();

  return hashIp(
    ipFromHeaderValue(headerStore.get("x-forwarded-for")) ??
      headerStore.get("x-real-ip") ??
      headerStore.get("cf-connecting-ip")
  );
}

export async function consumeRateLimit(input: {
  action: RateLimitAction;
  userId?: string | null;
  ipHash?: string | null;
  requestId?: string;
}) {
  if (process.env.NODE_ENV === "development" && input.action === "auth.login") {
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: new Date().toISOString()
    } satisfies RateLimitResult;
  }

  const env = getSupabaseServerEnv();

  if (!env.url || !env.serviceRoleKey) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  const rule = rateLimitRules[input.action];
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_user_id: input.userId ?? null,
      p_ip_hash: input.ipHash ?? null,
      p_action: input.action,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds
    });

    if (error) {
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const result: RateLimitResult = {
      allowed: Boolean(row?.allowed),
      remaining: Number(row?.remaining ?? 0),
      resetAt: String(row?.reset_at ?? new Date(Date.now() + rule.windowSeconds * 1000).toISOString())
    };

    if (!result.allowed) {
      logBackendEvent("warn", {
        requestId: input.requestId,
        action: input.action,
        userId: input.userId,
        statusCode: 429,
        rateLimited: true
      });
    }

    return result;
  } catch (error) {
    logBackendEvent("error", {
      requestId: input.requestId,
      action: input.action,
      userId: input.userId,
      statusCode: 500,
      errorType: errorType(error)
    });

    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + rule.windowSeconds * 1000).toISOString()
    };
  }
}

export function rateLimitMessage(resetAt: string) {
  return `Too many attempts. Try again after ${new Date(resetAt).toLocaleTimeString()}.`;
}
