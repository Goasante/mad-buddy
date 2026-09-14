import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The profile-photo gallery, extracted so both platforms run one implementation.
 *
 * Android cannot call a Server Action, so sharing the photo carousel needs a
 * REST route — and a route that reimplemented the upload would be a second
 * place for the rate limit, the admin guard, magic-byte validation, EXIF/GPS
 * stripping and the server-chosen slot to drift out of agreement.
 *
 * So the logic MOVED to lib/profile/photo-gallery-service.ts, and both the
 * Server Action and the route now delegate. These tests pin that arrangement:
 * that the security properties live in the service, that nothing was left
 * behind in a second copy, and that the route authenticates the other
 * transport without weakening anything.
 */

const read = (p: string) => readFileSync(p, "utf8");
const service = read("lib/profile/photo-gallery-service.ts");
const action = read("app/(app)/profile-photo-actions.ts");
const route = read("app/api/profile/photos/route.ts");

describe("there is one implementation, not two", () => {
  it("the Server Action delegates rather than duplicating", () => {
    for (const fn of [
      "addProfilePhoto",
      "deleteProfilePhoto",
      "reorderProfilePhoto",
      "setProfilePhotoVisibility"
    ]) {
      expect(action).toContain(`${fn}(createSupabaseAdminClient()`);
    }
    expect(action).toContain('from "@/lib/profile/photo-gallery-service"');
  });

  it("the route calls the SAME service", () => {
    expect(route).toContain('from "@/lib/profile/photo-gallery-service"');
    for (const fn of [
      "addProfilePhoto",
      "deleteProfilePhoto",
      "reorderProfilePhoto",
      "setProfilePhotoVisibility"
    ]) {
      expect(route).toContain(fn);
    }
  });

  it("the action keeps no copy of the behaviour it delegated", () => {
    /* The point of the extraction. If any of this is still here, there are two
       implementations again and only one of them gets fixed next time. */
    expect(action).not.toContain("validateImageUpload");
    expect(action).not.toContain("consumeRateLimit");
    expect(action).not.toContain("guardAction");
    expect(action).not.toContain("processImageUpload");
    expect(action).not.toContain("nextPhotoSlot");
    // 407 lines before the move; a delegating action is a fraction of that.
    expect(action.split("\n").length).toBeLessThan(180);
  });
});

describe("the security properties moved intact", () => {
  it("rate limits uploads", () => {
    expect(service).toContain('consumeRateLimit({ action: "media.upload", userId })');
  });

  it("applies the admin enforcement guard", () => {
    expect(service).toContain("guardAction(admin, { userId, surface: \"messaging\", control: \"media_uploads\" })");
  });

  it("validates by MAGIC BYTES, not the filename or claimed type", () => {
    // A .jpg extension proves nothing about what the bytes are.
    expect(service).toContain("file.slice(0, 32).arrayBuffer()");
    expect(service).toContain("validateImageUpload({");
    expect(service).toContain("headerBytes");
  });

  it("strips EXIF, including GPS, before anything reaches storage", () => {
    // The stored original is the metadata-free re-encode.
    expect(service).toContain("processImageUpload");
  });

  it("chooses the slot server-side, never from the client", () => {
    // A client-supplied position could overwrite a photo or exceed the cap.
    expect(service).toContain("nextPhotoSlot(");
    expect(service).toContain("MAX_PROFILE_PHOTOS");
  });

  it("rolls back a failed upload rather than leaving orphans", () => {
    expect(service).toContain("removeFailedUpload");
  });

  it("scopes every write to the caller's own rows", () => {
    // Without this a valid id from anywhere would be editable by anyone.
    expect(service.match(/\.eq\("user_id", userId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(service.match(/\.eq\("owner_id", userId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Reordering is ATOMIC, which it was not before this PR's review.
 *
 * The service used to issue three separate un-transacted writes -- park the
 * mover at -1, step the displaced row into the vacated slot, land the mover --
 * and IGNORED the error on the middle one. A failure there silently lost the
 * displaced photo's slot; a crash between writes stranded the mover at -1,
 * outside the 0..2 the carousel renders, so it vanished with no way to recover
 * it from the UI.
 *
 * Worse, the doc comment claimed it "goes through the reorder_profile_photo
 * function". No such function existed: the comment described a design that was
 * never built, and the migration that widened the position check to allow -1
 * promised in its column comment that "no photo is ever left there".
 *
 * These tests hold the promise that migration made.
 */
describe("a photo reorder is one transaction", () => {
  const rpc = read("supabase/migrations/20260914120000_reorder_profile_photo_rpc.sql");

  it("the function the comment always claimed now exists", () => {
    expect(rpc).toContain("create or replace function public.reorder_profile_photo(");
  });

  it("the service calls it instead of writing three times", () => {
    expect(service).toContain('admin.rpc("reorder_profile_photo"');
    // The un-transacted sequence must be gone from TypeScript entirely.
    expect(service).not.toContain("position: -1");
    expect(service).not.toContain("moveError");
    expect(service).not.toContain("finalError");
  });

  it("still parks at -1, but inside the transaction", () => {
    // The unique (user_id, position) constraint makes two direct updates
    // collide whichever order they run in, so the parking value is still
    // needed -- it is just never observable now.
    expect(rpc).toContain("set position = -1");
  });

  it("scopes all three writes to the owner", () => {
    expect((rpc.match(/and user_id = v_owner_id/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("is idempotent when the photo is already in that slot", () => {
    expect(rpc).toContain("if v_current_position = p_new_position then");
  });

  it("rejects a position outside the gallery cap", () => {
    expect(rpc).toContain("p_new_position < 0 or p_new_position > 2");
  });

  it("is not callable from a browser client", () => {
    // SECURITY DEFINER, and it resolves ownership from the row rather than
    // auth.uid() -- only the server may reach it.
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("revoke all on function public.reorder_profile_photo(uuid, smallint) from public, anon, authenticated");
    // service_role is granted back explicitly: a bare REVOKE strips it too,
    // which would break every server path.
    expect(rpc).toContain("grant execute on function public.reorder_profile_photo(uuid, smallint) to service_role");
  });

  it("pins search_path, so it cannot be hijacked by a shadowing schema", () => {
    expect(rpc).toContain("set search_path = public, pg_temp");
  });
});

describe("the service does no authentication of its own", () => {
  it("takes the admin client and a proven userId", () => {
    // Authentication belongs to the caller: a Server Action reads the cookie
    // session, the route resolves a Bearer token. Authorisation happens here.
    expect(service).toContain("admin: Admin,");
    expect(service).toContain("userId: string,");
    expect(service).not.toContain("createSupabaseServerClient");
    expect(service).not.toContain("auth.getUser()");
  });

  it("leaves revalidation to the Next caller", () => {
    // revalidatePath is meaningless to a Bearer-token API call.
    expect(service).not.toContain("revalidatePath");
    expect(action).toContain('revalidatePath("/profile")');
  });

  it("is server-only, so it can never reach a browser bundle", () => {
    expect(service.startsWith('import "server-only"')).toBe(true);
  });
});

describe("the route authenticates the other transport", () => {
  it("resolves a Bearer token and refuses without one", () => {
    expect(route).toContain("resolveApiUser(request)");
    expect(route).toContain('{ error: "Authentication required." }, { status: 401 }');
  });

  it("answers CORS preflight, which a cross-origin Bearer request needs", () => {
    expect(route).toContain("preflightResponse(request)");
    expect(route).toContain("withCors(");
  });

  it("takes the upload as multipart, the same shape the action receives", () => {
    // Re-parsing into a different shape would be a second opinion about what
    // counts as a valid upload.
    expect(route).toContain("request.formData()");
  });

  it("covers all four operations", () => {
    expect(route).toContain("export async function POST");
    expect(route).toContain("export async function PATCH");
    expect(route).toContain("export async function DELETE");
    expect(route).toContain("export function OPTIONS");
  });
});
