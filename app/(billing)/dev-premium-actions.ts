"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DevelopmentPlanState = {
  ok: boolean;
  message: string;
};

const developmentPlanSchema = z.enum(["free", "buddy_plus", "buddy_pro"]);

export async function setDevelopmentPlanAction(input: unknown): Promise<DevelopmentPlanState> {
  if (process.env.NODE_ENV === "production") {
    return { ok: false, message: "Development plan switching is disabled in production." };
  }

  const serverEnv = getSupabaseServerEnv();

  if (!serverEnv.url || !serverEnv.serviceRoleKey) {
    return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required for local plan testing." };
  }

  const parsed = developmentPlanSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose Free, Buddy Plus, or Buddy Pro." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, message: "Log in before switching test plans." };
  }

  const admin = createSupabaseAdminClient();
  const isFree = parsed.data === "free";
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + 30);

  const { error: upsertError } = await admin.from("subscriptions").upsert({
    user_id: user.id,
    plan: parsed.data,
    status: isFree ? "free" : "active",
    current_period_start: isFree ? null : now.toISOString(),
    current_period_end: isFree ? null : periodEnd.toISOString()
  });

  if (upsertError) {
    return { ok: false, message: "The development subscription could not be saved." };
  }

  revalidatePath("/billing");
  revalidatePath("/upgrade");

  return {
    ok: true,
    message: isFree ? "Local test plan set to Free." : `Local test plan set to ${parsed.data.replace("_", " ")}.`
  };
}
