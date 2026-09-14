import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import {
  addProfilePhoto,
  deleteProfilePhoto,
  reorderProfilePhoto,
  setProfilePhotoVisibility
} from "@/lib/profile/photo-gallery-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Profile photo gallery, for the native app.
 *
 * The web app reaches the same behaviour through the Server Actions in
 * app/(app)/profile-photo-actions.ts; both call
 * lib/profile/photo-gallery-service.ts, so the rate limit, the admin guard,
 * magic-byte validation, EXIF/GPS stripping, the server-chosen slot and the
 * rollback on a failed upload are one implementation rather than two.
 *
 * Authentication is the only difference: a Server Action reads the session
 * cookie, and this resolves a Bearer token through resolveApiUser. The service
 * is handed the userId either way and does its own authorisation against it.
 */

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Upload a photo.
 *
 * Takes multipart/form-data with a `media` file and an optional
 * `replacePhotoId` — the same shape the Server Action receives, so the service
 * reads it unchanged rather than through a second parser that could disagree
 * about what counts as a valid upload.
 */
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return withCors(NextResponse.json({ error: "Choose a photo first." }, { status: 400 }), request);
  }

  const result = await addProfilePhoto(createSupabaseAdminClient(), auth.user.id, formData);
  // A refusal here is a validation or authorisation problem (too many photos,
  // not an image, rate limited), not a malformed request.
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

/**
 * Change a photo's visibility or move it to another slot.
 *
 * One route for both because they are the same kind of edit to the same row,
 * distinguished by which field is present. `newPosition` means a move;
 * `visibility` means a visibility change.
 */
export async function PATCH(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return withCors(NextResponse.json({ error: "Not available." }, { status: 400 }), request);
  }

  const admin = createSupabaseAdminClient();
  const result =
    "newPosition" in body
      ? await reorderProfilePhoto(admin, auth.user.id, body)
      : await setProfilePhotoVisibility(admin, auth.user.id, body);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

/** Remove a photo. The media asset follows through the retention sweep. */
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = await request.json().catch(() => null);
  const result = await deleteProfilePhoto(createSupabaseAdminClient(), auth.user.id, body);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
