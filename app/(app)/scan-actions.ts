"use server";

import { checkInToEventAction, joinEventCircleAction } from "@/app/(app)/event-actions";
import { scanPersonalQrAction } from "@/app/(app)/invite-actions";
import { createPersonalQrToken, qrWindowIndex, QR_WINDOW_MS, shortCodeFromToken } from "@/lib/discovery/invites";
import { qrSecret } from "@/lib/discovery/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ScanResultState = {
  ok: boolean;
  message: string;
  kind?: "personal" | "event_check_in" | "circle_join";
};

/**
 * One scanner, three token kinds (batch 5 + batch 8 share the surface):
 *
 * - personal QR (`userId.window.mac`, 3 dot-parts) → friend request flow
 * - event token (`payload.mac`, 2 dot-parts)       → check-in or circle join
 * - 8-char short code                              → personal QR fallback
 *
 * This action only ROUTES. Every verification (signature, expiry, window,
 * purpose/context match) happens in the action it dispatches to, the payload
 * decode below is for routing only and grants nothing by itself.
 */
export async function resolveScannedCodeAction(raw: string): Promise<ScanResultState> {
  const code = raw.trim();
  if (!code || code.length > 600) return { ok: false, message: "That code isn't valid." };

  // Short code fallback (spec §35): recompute each user's code for the
  // current and previous windows and match. Deterministic, so no lookup
  // table, bounded and rate-limited instead.
  if (/^[0-9A-F]{8}$/i.test(code)) {
    const token = await tokenFromShortCode(code.toUpperCase());
    if (!token) return { ok: false, message: "That code isn't valid or has expired." };
    const result = await scanPersonalQrAction(token);
    return { ok: result.ok, message: result.message, kind: "personal" };
  }

  const parts = code.split(".");
  if (parts.length === 3) {
    const result = await scanPersonalQrAction(code);
    return { ok: result.ok, message: result.message, kind: "personal" };
  }

  if (parts.length === 2) {
    let payload: { contextId?: string; purpose?: string };
    try {
      payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    } catch {
      return { ok: false, message: "That code isn't valid." };
    }
    if (typeof payload.contextId !== "string") return { ok: false, message: "That code isn't valid." };

    if (payload.purpose === "check_in") {
      const result = await checkInToEventAction({ eventId: payload.contextId, token: code });
      return { ok: result.ok, message: result.message, kind: "event_check_in" };
    }
    if (payload.purpose === "circle_join") {
      const result = await joinEventCircleAction(payload.contextId, code);
      return { ok: result.ok, message: result.message, kind: "circle_join" };
    }
  }

  return { ok: false, message: "That code isn't recognised." };
}

async function tokenFromShortCode(shortCode: string): Promise<string | null> {
  const secret = qrSecret();
  if (!secret) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const rateLimit = await consumeRateLimit({ action: "invites.resolve", userId: user.id });
  if (!rateLimit.allowed) throw new Error(rateLimitMessage(rateLimit.resetAt));

  const admin = createSupabaseAdminClient();
  const { data: profiles } = await admin.from("profiles").select("user_id").limit(5000);
  if (!profiles) return null;

  const nowMs = Date.now();
  const windows = [nowMs, nowMs - QR_WINDOW_MS];
  for (const profile of profiles) {
    for (const windowMs of windows) {
      if (qrWindowIndex(windowMs) < 0) continue;
      const token = createPersonalQrToken(profile.user_id, secret, windowMs);
      if (shortCodeFromToken(token) === shortCode) return token;
    }
  }
  return null;
}
