import { NextResponse } from "next/server";
import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordBillingEvent } from "@/lib/revenue/events";

export async function POST(request: Request) {
  const originError = invalidMutationOriginResponse(request);
  if (originError) return originError;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 204 });

  const admin = createSupabaseAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();
  const plan = subscription?.plan ?? "free";
  const day = new Date().toISOString().slice(0, 10);

  try {
    await recordBillingEvent(admin, {
      event_type: "pricing_viewed",
      source: "app_server",
      user_id: user.id,
      subscription_plan: plan,
      dedupe_key: `pricing_viewed:${user.id}:${day}`
    });
  } catch {
    // A reporting outage must not make the public pricing page fail.
  }
  return new NextResponse(null, { status: 204 });
}
