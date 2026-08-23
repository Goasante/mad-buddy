import { NextResponse } from "next/server";
import { z } from "zod";
import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { errorType, logBackendEvent } from "@/lib/observability/logger";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(200)
  }),
  previousEndpoint: z.string().url().max(1000).optional()
});

export async function POST(request: Request) {
  const originError = invalidMutationOriginResponse(request);
  if (originError) return originError;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  if (parsed.data.previousEndpoint && parsed.data.previousEndpoint !== parsed.data.endpoint) {
    const { error: deleteError } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", parsed.data.previousEndpoint);
    if (deleteError) {
      /* Record the cause — see app/api/account/export/route.ts (MB-GOD-020).
         A push subscription that silently fails to replace leaves the device
         receiving nothing, with no trace of why. */
      logBackendEvent("error", {
        route: "/api/push-subscriptions",
        action: "push.replaceSubscription",
        statusCode: 500,
        errorType: errorType(deleteError)
      });
      return NextResponse.json({ error: "Could not replace subscription" }, { status: 500 });
    }
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: "Could not save subscription" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
