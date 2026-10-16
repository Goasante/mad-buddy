import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ isAdmin: vi.fn(), store: vi.fn(), get: vi.fn(), getWithMetadata: vi.fn(), set: vi.fn(), setJSON: vi.fn() }));
vi.mock("@/lib/shop/auth", async () => ({ ...(await vi.importActual<object>("@/lib/shop/auth")), isAdmin: mocks.isAdmin }));
vi.mock("@/lib/shop/store", () => ({ shopStore: mocks.store, audit: vi.fn() }));
vi.mock("./thesis-preview-manifest", async () => {
  const original = await vi.importActual<typeof import("./thesis-preview-manifest")>("./thesis-preview-manifest");
  const { createHash } = await import("node:crypto");
  return { ...original, PREVIEW_FILES: Object.fromEntries(["OPEN_THESIS_ARCHITECT.html", "LICENSE.txt"].map(name => [name, { size: 4, sha256: createHash("sha256").update("test").digest("hex") }])) };
});
import { BUYER_ZIP_SHA256, PREVIEW_PREFIX, previewPath } from "./thesis-preview-manifest";
import { GET } from "@/app/admin/previews/thesis-architect/[...path]/route";
import { POST } from "@/app/api/admin/thesis-preview/route";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = () => new Request("https://books.example.com/admin/previews/thesis-architect/OPEN_THESIS_ARCHITECT.html");
const upload = (data?: FormData, origin = "https://books.example.com") => new Request("https://books.example.com/api/admin/thesis-preview", { method: "POST", headers: { origin }, body: data });
beforeEach(() => {
  vi.clearAllMocks(); mocks.isAdmin.mockResolvedValue(false);
  mocks.store.mockReturnValue({ get: mocks.get, getWithMetadata: mocks.getWithMetadata, set: mocks.set, setJSON: mocks.setJSON });
  mocks.get.mockResolvedValue({ packageSha256: BUYER_ZIP_SHA256 });
  mocks.getWithMetadata.mockResolvedValue({ data: new TextEncoder().encode("test").buffer, metadata: { sha256: createHash("sha256").update("test").digest("hex") } });
  process.env.NEXT_PUBLIC_APP_URL = "https://books.example.com";
});
describe("Thesis Architect private candidate", () => {
  it("blocks every anonymous file before reading storage", async () => {
    for (const path of [["OPEN_THESIS_ARCHITECT.html"], ["The_Thesis_Architect_Guide.pdf"], ["Examples", "ESSAY_Practice_Project.json"]]) {
      const result = await GET(request(), context(path));
      expect(result.status).toBe(401); expect(result.headers.get("Cache-Control")).toContain("no-store");
    }
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects unknown paths and encoded traversal", () => {
    for (const parts of [["..", "LICENSE.txt"], ["%2e%2e"], ["Examples/ESSAY_Practice_Project.json"], ["a\\b"], ["unknown.html"], ["", "LICENSE.txt"]]) expect(previewPath(parts)).toBeNull();
    expect(previewPath(["LICENSE.txt"])).toBe("LICENSE.txt");
  });
  it("requires a matching complete-package ready record", async () => {
    mocks.isAdmin.mockResolvedValue(true); mocks.get.mockResolvedValue({ packageSha256: "wrong" });
    expect((await GET(request(), context(["OPEN_THESIS_ARCHITECT.html"]))).status).toBe(404);
    expect(mocks.getWithMetadata).not.toHaveBeenCalled();
  });
  it("refuses actual byte corruption even with matching metadata", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getWithMetadata.mockResolvedValue({ data: new TextEncoder().encode("evil").buffer, metadata: { sha256: createHash("sha256").update("test").digest("hex") } });
    expect((await GET(request(), context(["OPEN_THESIS_ARCHITECT.html"]))).status).toBe(404);
  });
  it("serves only owner-authenticated noncached hash-restricted HTML", async () => {
    mocks.isAdmin.mockResolvedValue(true); const result = await GET(request(), context(["OPEN_THESIS_ARCHITECT.html"]));
    expect(result.status).toBe(200); expect(await result.text()).toBe("test");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("Netlify-CDN-Cache-Control")).toBe("no-store");
    expect(result.headers.get("Vary")).toBe("Cookie");
    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
    const csp = result.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'sha256-"); expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'"); expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
  it("requires same-origin owner authentication for uploads", async () => {
    expect((await POST(upload(undefined,"https://other.example"))).status).toBe(403);
    expect((await POST(upload())).status).toBe(401); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects incomplete, duplicate and modified uploads before writes", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    for (const values of [[['OPEN_THESIS_ARCHITECT.html','test']], [['OPEN_THESIS_ARCHITECT.html','test'],['OPEN_THESIS_ARCHITECT.html','test']], [['OPEN_THESIS_ARCHITECT.html','evil'],['LICENSE.txt','test']]]) {
      const data = new FormData(); for (const [name,value] of values) data.append("files", new File([value],name));
      expect((await POST(upload(data))).status).toBe(400);
    }
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("writes readiness only after all validated customer files", async () => {
    mocks.isAdmin.mockResolvedValue(true); const data = new FormData();
    for (const name of ["OPEN_THESIS_ARCHITECT.html","LICENSE.txt"]) data.append("files",new File(["test"],name));
    expect((await POST(upload(data))).status).toBe(200); expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.setJSON).toHaveBeenCalledWith(PREVIEW_PREFIX+"ready",{packageSha256:BUYER_ZIP_SHA256,files:2},{onlyIfNew:true});
    expect(mocks.setJSON.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.set.mock.invocationCallOrder[1]);
  });
  it("does not publish readiness after a failed storage write", async () => {
    mocks.isAdmin.mockResolvedValue(true); mocks.set.mockRejectedValueOnce(new Error("failure")); const data = new FormData();
    for (const name of ["OPEN_THESIS_ARCHITECT.html","LICENSE.txt"]) data.append("files",new File(["test"],name));
    expect((await POST(upload(data))).status).toBe(503); expect(mocks.setJSON).not.toHaveBeenCalled();
  });
  it("rejects oversized requests before parsing", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    expect((await POST(new Request("https://books.example.com/api/admin/thesis-preview", { method:"POST",headers:{origin:"https://books.example.com","content-length":String(5*1024*1024)} }))).status).toBe(413);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
