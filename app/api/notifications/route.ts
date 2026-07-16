import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { toNotificationResponse } from "@/lib/notifications/server";

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
