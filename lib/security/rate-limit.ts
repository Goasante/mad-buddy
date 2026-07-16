import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { errorType, logBackendEvent } from "@/lib/observability/logger";

export type RateLimitAction =
  | "auth.signup"
  | "auth.login"
  | "friends.search"
  | "friends.request"
  | "location.update"
  | "friends.nearby"
  | "reports.create"
  | "paystack.initialize";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export const rateLimitRules: Record<RateLimitAction, { limit: number; windowSeconds: number }> = {
  "auth.signup": { limit: 5, windowSeconds: 15 * 60 },
  "auth.login": { limit: 10, windowSeconds: 15 * 60 },
  "friends.search": { limit: 30, windowSeconds: 60 },
  "friends.request": { limit: 10, windowSeconds: 24 * 60 * 60 },
  "location.update": { limit: 60, windowSeconds: 60 },
  "friends.nearby": { limit: 60, windowSeconds: 60 },
  "reports.create": { limit: 5, windowSeconds: 60 * 60 },
  "paystack.initialize": { limit: 5, windowSeconds: 15 * 60 }
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
