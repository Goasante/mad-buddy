import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { toNotificationResponse } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

const notificationResponseSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string(),
      title: z.string(),
      message: z.string(),
      is_read: z.boolean(),
      created_at: z.string()
    })
  )
});

// Cursor pagination (audit I-14): callers may pass ?limit=1..100 and
// ?before=<ISO timestamp> to page backward through history. Defaults keep
// the previous behavior (newest 50) so existing clients are unaffected.
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional()
});

const deleteNotificationsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200)
});

export async function GET(request: Request) {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 503 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsedPagination = paginationSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    before: url.searchParams.get("before") ?? undefined
  });

  if (!parsedPagination.success) {
    return NextResponse.json(
      { error: "Invalid pagination. Use limit=1..100 and before=<ISO timestamp>." },
      { status: 400 }
    );
  }

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(parsedPagination.data.limit);

  if (parsedPagination.data.before) {
    query = query.lt("created_at", parsedPagination.data.before);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }

  const response = notificationResponseSchema.parse({
    notifications: data.map(toNotificationResponse)
  });

  const oldest = response.notifications.at(-1)?.created_at ?? null;

  return NextResponse.json({
    ...response,
    next_before: response.notifications.length === parsedPagination.data.limit ? oldest : null
  });
}

export async function DELETE(request: Request) {
  const env = getSupabaseServerEnv();

  if (!env.url || !env.anonKey || !env.serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 });
  }

  const body = deleteNotificationsSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Choose between 1 and 200 notifications to delete." }, { status: 400 });
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

  // Authenticate with the user's session, then perform the mutation through
  // the trusted server client. The verified user id remains a mandatory
  // filter, so ids belonging to another account can never be deleted.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .delete()
    .eq("user_id", user.id)
    .in("id", body.data.ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: "Could not delete those notifications." }, { status: 500 });
  }

  const deletedIds = (data ?? []).map((notification) => notification.id);
  const deletedIdSet = new Set(deletedIds);
  const notDeleted = body.data.ids.filter((id) => !deletedIdSet.has(id));

  if (notDeleted.length > 0) {
    return NextResponse.json(
      { error: "Some notifications could not be deleted.", deletedIds },
      { status: 409 }
    );
  }

  return NextResponse.json(
    { deletedIds },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
