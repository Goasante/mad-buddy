import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), owner: vi.fn(), maybeSingle: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }), storage: { from: () => ({ download: mocks.download }) } }) }));
vi.mock("@/lib/blog/admin", () => ({ blogOwnerContext: mocks.owner }));
import { GET } from "@/app/blog/media/[id]/route";
const id = "4d8d6b75-7b43-4cb7-9c53-8a1bc5871ed3";
const get = (imageId = id) => GET(new Request(`https://mad-buddy.com/blog/media/${imageId}`), { params: Promise.resolve({ id: imageId }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  mocks.owner.mockResolvedValue(null);
  mocks.maybeSingle.mockResolvedValue({ data: { sha256: "a".repeat(64), bytes: 3 }, error: null });
  mocks.download.mockResolvedValue({ data: new Blob([Uint8Array.from([255, 216, 255])]), error: null });
});
describe("draft image access", () => {
  it("hides draft and unattached images from signed-out readers", async () => {
    const response = await get(); expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("allows the owner to preview with no public cache", async () => {
    mocks.owner.mockResolvedValue({ context: {} });
    const response = await get(); expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });
  it("serves current published images as compact, cached JPEGs", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await get(); expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=300");
    expect(response.headers.get("Vary")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(mocks.owner).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and fails closed on visibility errors", async () => {
    expect((await get("../private")).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await get()).status).toBe(503);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("rejects a corrupt or oversized stored object", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(205000)]), error: null });
    expect((await get()).status).toBe(404);
  });
  it("does not serve an image after its publication reference is removed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect((await get()).status).toBe(200);
    mocks.download.mockClear();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const response = await get();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("starts visibility and metadata lookups together but waits before downloading", async () => {
    let resolveVisibility!: (value: { data: boolean; error: null }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveVisibility = resolve; }));
    const response = get();
    await Promise.resolve();
    expect(mocks.maybeSingle).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    resolveVisibility({ data: true, error: null });
    expect((await response).status).toBe(200);
  });
});
