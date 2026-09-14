import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { uploadProfileAvatar } from "@/lib/profile/avatar-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Avatar upload, for the native app.
 *
 * DELIBERATELY A SIBLING of /api/profile/avatar rather than a POST on it. That
 * route is a cookie-authenticated image PROXY for the web app: it has no
 * resolveApiUser and no CORS, and it exists to serve the signed-in person's own
 * avatar bytes. Mixing a Bearer-authenticated upload into the same file would
 * put two different auth models in one place, where a later edit to the shared
 * imports could quietly change the posture of the proxy.
 *
 * The web app reaches the same behaviour through uploadAvatarAction; both call
 * lib/profile/avatar-service.ts, so the magic-byte validation, the
 * EXIF-stripping re-encode, the stored-file verification and the rollback on
 * every failure branch are one implementation rather than two.
 */

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  /* multipart/form-data, with the boundary the client's FormData generated.
     The mobile api client sends this through postForm(), which leaves
     content-type unset precisely so the browser can write that boundary --
     setting it by hand leaves the parts unsplittable. */
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return withCors(
      NextResponse.json({ ok: false, message: "Choose an avatar image first." }, { status: 400 }),
      request
    );
  }

  const result = await uploadProfileAvatar(createSupabaseAdminClient(), auth.user, formData);
  // A refusal here is a validation or processing problem (not an image, too
  // large, unconvertible HEIC), not a malformed request.
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
