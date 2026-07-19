"use server";

import { z } from "zod";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type HelpActionState = { ok: boolean; message: string };

const supportRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(3).max(2000)
});

export async function submitSupportRequestAction(input: unknown): Promise<HelpActionState> {
  const parsed = supportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your name, email address, and message." };

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, message: "Log in before contacting support." };

  const limit = await consumeRateLimit({ action: "support.request", userId: user.id });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const { error } = await supabase.from("support_requests").insert({
    user_id: user.id,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
    message: parsed.data.message
  });
  return error
    ? { ok: false, message: "Couldn't send your message. Try again." }
    : { ok: true, message: "Thanks, your message was sent." };
}
