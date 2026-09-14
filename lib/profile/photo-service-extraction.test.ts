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
    expect(service.match(/\.eq\("user_id", userId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(service.match(/\.eq\("owner_id", userId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("parks a moving photo at -1 so a swap cannot collide", () => {
    // -1 is outside the 0..2 the column allows, so a half-applied swap is
    // visibly wrong rather than silently plausible.
    expect(service).toContain("position: -1");
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
