import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMissingPaystackWebhookConfig } from "@/lib/paystack/config";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  message: string;
};

export type ReadinessReport = {
  ok: boolean;
  checkedAt: string;
  checks: ReadinessCheck[];
};

function hasValue(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const env = getSupabaseServerEnv();
  const checks: ReadinessCheck[] = [
    {
      name: "supabase_url",
      ok: hasValue(env.url),
      message: hasValue(env.url) ? "Configured" : "Missing NEXT_PUBLIC_SUPABASE_URL"
    },
    {
      name: "supabase_public_key",
      ok: hasValue(env.anonKey),
      message: hasValue(env.anonKey)
        ? "Configured"
        : "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    },
    {
      name: "supabase_service_role",
      ok: hasValue(env.serviceRoleKey),
      message: hasValue(env.serviceRoleKey) ? "Configured" : "Missing SUPABASE_SERVICE_ROLE_KEY"
    },
    {
      name: "app_url",
      ok: hasValue(process.env.NEXT_PUBLIC_APP_URL),
      message: hasValue(process.env.NEXT_PUBLIC_APP_URL) ? "Configured" : "Missing NEXT_PUBLIC_APP_URL"
    },
    {
      name: "admin_emails",
      ok: hasValue(process.env.ADMIN_EMAILS),
      message: hasValue(process.env.ADMIN_EMAILS) ? "Configured" : "Missing ADMIN_EMAILS"
    }
  ];

  const missingPaystack = getMissingPaystackWebhookConfig().concat(
    !hasValue(process.env.PAYSTACK_BUDDY_PLUS_PLAN_CODE) ? ["PAYSTACK_BUDDY_PLUS_PLAN_CODE"] : [],
    !hasValue(process.env.PAYSTACK_BUDDY_PRO_PLAN_CODE) ? ["PAYSTACK_BUDDY_PRO_PLAN_CODE"] : []
  );

  checks.push({
    name: "paystack",
    ok: missingPaystack.length === 0,
    message: missingPaystack.length === 0 ? "Configured" : `Missing ${missingPaystack.length} Paystack value(s)`
  });

  if (hasValue(env.url) && hasValue(env.serviceRoleKey)) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("profiles").select("id", { head: true, count: "exact" }).limit(1);

      checks.push({
        name: "supabase_database",
        ok: !error,
        message: error ? "Database check failed" : "Reachable"
      });
    } catch {
      checks.push({
        name: "supabase_database",
        ok: false,
        message: "Database check failed"
      });
    }
  } else {
    checks.push({
      name: "supabase_database",
      ok: false,
      message: "Skipped because Supabase server env is incomplete"
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    checks
  };
}
