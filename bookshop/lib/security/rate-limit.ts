import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export type RateLimitAction = "books.webhook" | "books.checkout" | "books.verify" | "books.download" | "books.recover" | "books.recover.email";
const rules: Record<RateLimitAction,{limit:number;windowSeconds:number}> = {
  "books.webhook": { limit: 1200, windowSeconds: 60 },
  "books.checkout": { limit: 5, windowSeconds: 15 * 60 },
  "books.verify": { limit: 20, windowSeconds: 15 * 60 },
  "books.download": { limit: 15, windowSeconds: 15 * 60 },
  "books.recover": { limit: 3, windowSeconds: 60 * 60 },
  "books.recover.email": { limit: 3, windowSeconds: 60 * 60 },
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
    ipFromHeaderValue(request.headers.get("x-nf-client-connection-ip")) ??
    ipFromHeaderValue(request.headers.get("x-forwarded-for")) ??
      request.headers.get("x-real-ip") ??
      request.headers.get("cf-connecting-ip")
  );
}

export async function consumeRateLimit(input: { action: RateLimitAction; ipHash?: string | null }) {
 const rule=rules[input.action];
 try {
  const {data,error}=await createSupabaseAdminClient().rpc("consume_rate_limit",{p_user_id:null,p_ip_hash:input.ipHash ?? null,p_action:input.action,p_limit:rule.limit,p_window_seconds:rule.windowSeconds});
  if(error)throw error; const row=Array.isArray(data)?data[0]:data;
  return {allowed:Boolean(row?.allowed),remaining:Number(row?.remaining ?? 0),resetAt:String(row?.reset_at ?? "")};
 } catch { return {allowed:false,remaining:0,resetAt:new Date(Date.now()+60_000).toISOString()}; }
}
