import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_start, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load subscription status." }, { status: 500 });
  }

  return NextResponse.json(
    data ?? {
      plan: "free",
      status: "free",
      current_period_start: null,
      current_period_end: null
    }
  );
}
