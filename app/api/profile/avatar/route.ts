import { NextResponse } from "next/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.avatar_url) {
    return NextResponse.json({ error: "Profile photo not found" }, { status: 404 });
  }

  const { url: supabaseUrl } = getSupabaseBrowserEnv();

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Profile photo is unavailable" }, { status: 503 });
  }

  try {
    const source = new URL(profile.avatar_url);
    const storageOrigin = new URL(supabaseUrl).origin;
    const expectedPath = `/storage/v1/object/public/avatars/${user.id}/`;

    // Only proxy the signed-in user's public avatar. This prevents the stored
    // URL from turning the route into a general-purpose server-side fetcher.
    if (source.origin !== storageOrigin || !source.pathname.startsWith(expectedPath)) {
      return NextResponse.json({ error: "Profile photo is unavailable" }, { status: 404 });
    }

    const response = await fetch(source, { cache: "no-store" });
    const contentType = response.headers.get("content-type");

    if (!response.ok || !contentType?.startsWith("image/")) {
      return NextResponse.json({ error: "Profile photo is unavailable" }, { status: 404 });
    }

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Profile photo is unavailable" }, { status: 404 });
  }
}
