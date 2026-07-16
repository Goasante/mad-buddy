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

export async function GET() {
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

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response = notificationResponseSchema.parse({
    notifications: data.map(toNotificationResponse)
  });

  return NextResponse.json(response);
}
