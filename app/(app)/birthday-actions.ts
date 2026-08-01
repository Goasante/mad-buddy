"use server";

import { z } from "zod";
import { sendBirthdayWish } from "@/lib/profile/birthday-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  targetUserId: z.string().uuid(),
  wish: z.string().max(80)
});

export async function sendBirthdayWishAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a birthday wish." };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Log in before sending a birthday wish." };
  return sendBirthdayWish(createSupabaseAdminClient(), user.id, parsed.data.targetUserId, parsed.data.wish);
}
