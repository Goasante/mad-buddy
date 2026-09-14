import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The avatar upload's two gates, tested by BEHAVIOUR rather than by source text.
 *
 * WHY THIS FILE EXISTS (PR #95 review): the upload decodes an image through
 * Sharp and writes to a PUBLIC bucket, and it had neither a rate limit nor the
 * media_uploads enforcement guard. The gap predates the extraction — the
 * original Server Action never had them either — but it was latent while the
 * only way to reach it was driving the web UI. Adding
 * /api/profile/avatar/upload made the same path scriptable, which is what
 * turned a latent gap into one worth closing.
 *
 * Source-text assertions would prove the calls EXIST. These prove they BLOCK:
 * that a refusal happens before the request body is read, before Sharp is
 * loaded, and before anything reaches storage. A gate that runs after the
 * expensive work has been done is not a gate.
 */

const consumeRateLimit = vi.fn();
const guardAction = vi.fn();
const optimizeProfileAvatar = vi.fn();

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
  rateLimitMessage: () => "Too many uploads. Try again shortly."
}));
vi.mock("@/lib/admin/enforcement", () => ({
  guardAction: (...args: unknown[]) => guardAction(...args)
}));
vi.mock("@/lib/media/processing", () => ({
  optimizeProfileAvatar: (...args: unknown[]) => optimizeProfileAvatar(...args),
  toStorageArrayBuffer: (buffer: Buffer) => buffer
}));
vi.mock("@/lib/observability/logger", () => ({
  createRequestId: () => "test-request",
  errorType: () => "TestError",
  logBackendEvent: () => {}
}));

const { uploadProfileAvatar } = await import("./avatar-service");

/** Records every storage and table call so a "did nothing" claim is checkable. */
function makeAdmin() {
  const storageCalls: string[] = [];
  const tableCalls: string[] = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string) => {
            storageCalls.push(`upload:${bucket}/${path}`);
            return { error: null };
          },
          download: async () => {
            storageCalls.push(`download:${bucket}`);
            return { data: null, error: new Error("not stored") };
          },
          remove: async () => {
            storageCalls.push(`remove:${bucket}`);
            return { error: null };
          },
          list: async () => ({ data: [] }),
          getPublicUrl: () => ({ data: { publicUrl: "https://example.test/a.webp" } })
        };
      }
    },
    from(table: string) {
      tableCalls.push(table);
      const chain = {
        update: () => chain,
        insert: async () => ({ error: null }),
        eq: () => chain,
        select: () => chain,
        maybeSingle: async () => ({ data: null, error: null })
      };
      return chain;
    },
    auth: { admin: { updateUserById: async () => ({}) } }
  };
  return { admin: admin as never, storageCalls, tableCalls };
}

/** A real File, so nothing is refused for being the wrong shape. */
function avatarForm() {
  // A minimal PNG header, enough that validation is reached rather than
  // short-circuited on an empty file.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
  const form = new FormData();
  form.append("avatar", new File([png], "avatar.png", { type: "image/png" }));
  return form;
}

const user = { id: "user-1", email: "a@b.test", user_metadata: {} } as never;

beforeEach(() => {
  consumeRateLimit.mockReset();
  guardAction.mockReset();
  optimizeProfileAvatar.mockReset();
  // Default: both gates open, so each test blocks exactly one thing.
  consumeRateLimit.mockResolvedValue({ allowed: true });
  guardAction.mockResolvedValue({ allowed: true });
});

describe("the rate limit blocks the upload", () => {
  it("refuses when the limit is spent", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 60_000 });
    const { admin } = makeAdmin();

    const result = await uploadProfileAvatar(admin, user, avatarForm());

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Too many uploads. Try again shortly.");
  });

  it("does no image processing when refused", async () => {
    // The whole point: Sharp is expensive, and a spent limit must cost nothing.
    consumeRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 60_000 });
    const { admin } = makeAdmin();

    await uploadProfileAvatar(admin, user, avatarForm());

    expect(optimizeProfileAvatar).not.toHaveBeenCalled();
  });

  it("writes nothing to storage or the profile when refused", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 60_000 });
    const { admin, storageCalls, tableCalls } = makeAdmin();

    await uploadProfileAvatar(admin, user, avatarForm());

    expect(storageCalls).toEqual([]);
    expect(tableCalls).toEqual([]);
  });

  it("counts against media.upload, the same budget as gallery photos", async () => {
    // One budget for images, not a separate allowance per surface.
    const { admin } = makeAdmin();
    await uploadProfileAvatar(admin, user, avatarForm());
    expect(consumeRateLimit).toHaveBeenCalledWith({ action: "media.upload", userId: "user-1" });
  });

  it("is consumed before the guard, so a blocked account still costs a token", async () => {
    // Ordering is deliberate: otherwise a restricted account could probe the
    // guard indefinitely for free.
    const { admin } = makeAdmin();
    await uploadProfileAvatar(admin, user, avatarForm());
    expect(consumeRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      guardAction.mock.invocationCallOrder[0]
    );
  });
});

describe("the enforcement guard blocks the upload", () => {
  it("refuses with the guard's own message", async () => {
    // The guard distinguishes a suspension from a killed feature; passing its
    // message through keeps that distinction visible to the person.
    guardAction.mockResolvedValue({ allowed: false, message: "Media uploads are paused." });
    const { admin } = makeAdmin();

    const result = await uploadProfileAvatar(admin, user, avatarForm());

    expect(result).toEqual({ ok: false, message: "Media uploads are paused." });
  });

  it("does no image processing when refused", async () => {
    guardAction.mockResolvedValue({ allowed: false, message: "Media uploads are paused." });
    const { admin } = makeAdmin();

    await uploadProfileAvatar(admin, user, avatarForm());

    expect(optimizeProfileAvatar).not.toHaveBeenCalled();
  });

  it("writes nothing to storage or the profile when refused", async () => {
    guardAction.mockResolvedValue({ allowed: false, message: "Media uploads are paused." });
    const { admin, storageCalls, tableCalls } = makeAdmin();

    await uploadProfileAvatar(admin, user, avatarForm());

    expect(storageCalls).toEqual([]);
    expect(tableCalls).toEqual([]);
  });

  it("asks about media_uploads, matching the photo gallery", async () => {
    // Same surface and control as lib/profile/photo-gallery-service.ts: an
    // avatar is a photo upload, and there is no "profile" GuardedSurface.
    const { admin } = makeAdmin();
    await uploadProfileAvatar(admin, user, avatarForm());
    expect(guardAction).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      surface: "messaging",
      control: "media_uploads"
    });
  });
});

describe("both gates run before the request body is even read", () => {
  it("refuses a spent limit without inspecting the form", async () => {
    /* A gate that reads the file first has already paid for parsing a
       multipart body — which on a phone photo is several megabytes. */
    consumeRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 60_000 });
    const { admin } = makeAdmin();

    const form = new FormData();
    const get = vi.spyOn(form, "get");
    await uploadProfileAvatar(admin, user, form as never);

    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a blocked account without inspecting the form", async () => {
    guardAction.mockResolvedValue({ allowed: false, message: "Media uploads are paused." });
    const { admin } = makeAdmin();

    const form = new FormData();
    const get = vi.spyOn(form, "get");
    await uploadProfileAvatar(admin, user, form as never);

    expect(get).not.toHaveBeenCalled();
  });
});
