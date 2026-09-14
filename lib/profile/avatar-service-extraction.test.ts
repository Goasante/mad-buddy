import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Avatar upload, extracted so both platforms run one implementation.
 *
 * Last of the four Profile extractions (photos #92, interests #93, trust #94).
 * An avatar is a PUBLIC asset on a public bucket, which is why the
 * EXIF-stripping re-encode and the stored-file verification below matter more
 * here than anywhere else: a photo that kept its GPS tags would be readable by
 * anyone with the URL.
 */

const read = (p: string) => readFileSync(p, "utf8");
const service = read("lib/profile/avatar-service.ts");
const action = read("app/(app)/actions.ts");
const route = read("app/api/profile/avatar/upload/route.ts");
const client = read("mobile/src/lib/api.ts");

describe("there is one implementation, not two", () => {
  it("the Server Action delegates rather than duplicating", () => {
    expect(action).toContain("uploadProfileAvatar(createSupabaseAdminClient(), user, formData)");
    expect(action).toContain('from "@/lib/profile/avatar-service"');
  });

  it("the route calls the SAME service", () => {
    expect(route).toContain('from "@/lib/profile/avatar-service"');
    expect(route).toContain("uploadProfileAvatar(createSupabaseAdminClient(), auth.user, formData)");
  });

  it("the action keeps no copy of the behaviour it delegated", () => {
    expect(action).not.toContain("validateImageUpload");
    expect(action).not.toContain("optimizeProfileAvatar");
    expect(action).not.toContain("sniffImageKind");
    expect(action).not.toContain('storage.from("avatars")');
  });
});

describe("the upload protections moved intact", () => {
  it("validates by MAGIC BYTES, not the filename or claimed type", () => {
    expect(service).toContain("file.slice(0, 32).arrayBuffer()");
    expect(service).toContain("validateImageUpload({");
    expect(service).toContain("headerBytes");
  });

  it("strips EXIF by re-encoding, which matters on a PUBLIC bucket", () => {
    // A stored original with GPS tags would be readable by anyone with the URL.
    expect(service).toContain("optimizeProfileAvatar");
  });

  it("verifies what was actually STORED, not what was sent", () => {
    // Re-downloads and sniffs the bytes: an upload that silently stored the
    // wrong thing would otherwise become someone's public avatar.
    expect(service).toContain('storage.from("avatars").download(path)');
    expect(service).toContain("sniffImageKind");
    expect(service).toContain('storedKind !== "webp"');
  });

  it("rolls back the stored file on every failure after upload", () => {
    // Verification failure, profile write failure, and the fallback-insert
    // failure each remove the object rather than orphaning it.
    expect(service.match(/storage\.from\("avatars"\)\.remove\(\[path\]\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("scopes the profile write to the caller", () => {
    expect(service).toContain('.eq("user_id", userId)');
    expect(service).toContain("const userId = user.id;");
  });

  it("keeps Sharp behind a LAZY import", () => {
    /* A profile or date-of-birth save must not fail merely because the
       deployment cannot load Sharp's native runtime. */
    const staticImports = service
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");
    expect(staticImports).not.toContain("@/lib/media/processing");
    expect(service).toContain('await import("@/lib/media/processing")');
  });

  it("treats auth metadata as a mirror, not the source of truth", () => {
    // profiles.avatar_url is authoritative; a failed metadata update must not
    // fail the upload.
    expect(service).toContain("admin.auth.admin.updateUserById");
    expect(service).toContain("Profile.avatar_url is the source of truth");
  });
});

describe("the service does no authentication of its own", () => {
  it("takes the admin client and a proven USER", () => {
    // The user, not just an id: the fallback profile reads user_metadata and
    // email to derive a name and username.
    expect(service).toContain("admin: Admin,");
    expect(service).toContain("user: User,");
    expect(service).not.toContain("createSupabaseServerClient");
    expect(service).not.toContain("auth.getUser()");
  });

  it("leaves revalidation to the Next caller", () => {
    expect(service).not.toContain("revalidatePath");
    expect(action).toContain('revalidatePath("/profile")');
    expect(action).toContain('revalidatePath("/dashboard")');
    expect(action).toContain('revalidatePath("/friends")');
  });

  it("is server-only, so it can never reach a browser bundle", () => {
    expect(service.startsWith('import "server-only"')).toBe(true);
  });
});

describe("the route is a sibling, not a POST on the image proxy", () => {
  it("lives at its own path", () => {
    /* /api/profile/avatar is a COOKIE-authenticated image proxy with no
       resolveApiUser and no CORS. Mixing a Bearer-authenticated upload into
       that file would put two auth models in one place, where a later edit to
       the shared imports could quietly change the proxy's posture. */
    const proxy = read("app/api/profile/avatar/route.ts");
    expect(proxy).not.toContain("resolveApiUser");
    expect(proxy).not.toContain("export async function POST");
    expect(route).toContain("resolveApiUser(request)");
  });

  it("answers CORS preflight and refuses without a Bearer token", () => {
    expect(route).toContain("preflightResponse(request)");
    expect(route).toContain("withCors(");
    expect(route).toContain('{ error: "Authentication required." }, { status: 401 }');
  });

  it("reads the upload as multipart", () => {
    expect(route).toContain("request.formData()");
  });
});

describe("the native client can actually send a file", () => {
  it("has a multipart helper that does not stringify", () => {
    // api.post JSON-stringifies its body, which would turn a FormData into the
    // string "[object FormData]".
    expect(client).toContain("postForm:");
    expect(client).toContain('request<T>(path, { method: "POST", body: form })');
  });

  it("does NOT set content-type for a FormData body", () => {
    /* THE DEFECT THIS PREVENTS: request() used to force
       content-type: application/json onto any body without one. The browser
       then never writes the multipart boundary, the server cannot split the
       parts, and the upload fails with no visible cause -- the request
       succeeds, it is the parse that does not. */
    expect(client).toContain("!(rest.body instanceof FormData)");
  });
});
