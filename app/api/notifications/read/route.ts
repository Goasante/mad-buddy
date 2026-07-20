import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

// Backward compatible: an empty body still marks every notification read.
// Additively supports a bounded set of ids and an explicit read state so the
// Pulse bulk-selection controls can mark a selection read or unread with the
// same endpoint (no new table, no schema change).
const markReadRequestSchema = z.object({
  notificationId: z.string().uuid().optional(),
  ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  isRead: z.boolean().optional()
});

export async function PATCH(request: Request) {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 503 }
    );
  }

  const body = markReadRequestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: "Invalid notification read request." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({ action: "notifications.mutate", userId: user.id });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }

  const isRead = body.data.isRead ?? true;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("notifications")
    .update({ is_read: isRead })
    .eq("user_id", user.id);

  if (body.data.notificationId) {
    query = query.eq("id", body.data.notificationId);
  } else if (body.data.ids && body.data.ids.length > 0) {
    query = query.in("id", body.data.ids);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: "Could not update notification status." }, { status: 500 });
  }

  return NextResponse.json({ isRead });
}
