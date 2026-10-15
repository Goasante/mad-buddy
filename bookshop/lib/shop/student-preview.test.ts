import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER_ZIP_SHA256, PREVIEW_FILES, PREVIEW_PREFIX, previewPath } from "./student-preview-manifest";
const mocks = vi.hoisted(() => ({ isAdmin: vi.fn(), store: vi.fn(), get: vi.fn(), getWithMetadata: vi.fn(), set: vi.fn(), setJSON: vi.fn() }));
vi.mock("@/lib/shop/auth", async () => ({ ...(await vi.importActual<object>("@/lib/shop/auth")), isAdmin: mocks.isAdmin }));
vi.mock("@/lib/shop/store", () => ({ shopStore: mocks.store, audit: vi.fn() }));
import { GET } from "@/app/admin/previews/student-edge/[...path]/route";
import { POST } from "@/app/api/admin/student-preview/route";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = () => new Request("https://books.example.com/admin/previews/student-edge/OPEN_INTERACTIVE_READER.html");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin.mockResolvedValue(false);
  mocks.store.mockReturnValue({ get: mocks.get, getWithMetadata: mocks.getWithMetadata, set: mocks.set, setJSON: mocks.setJSON });
  mocks.get.mockResolvedValue({ packageSha256: BUYER_ZIP_SHA256 });
  process.env.NEXT_PUBLIC_APP_URL = "https://books.example.com";
});
describe("private owner preview", () => {
  it("blocks anonymous readers and every companion file before accessing storage", async () => {
    for (const path of [["OPEN_INTERACTIVE_READER.html"], ["GOA_The_Student_Edge.pdf"], ["Templates", "Study_Toolkit.xlsx"]]) {
      const result = await GET(request(), context(path));
      expect(result.status).toBe(401);
      expect(result.headers.get("Cache-Control")).toContain("no-store");
      expect(await result.text()).not.toContain("Academic learning coach");
    }
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects traversal, unknown paths and encoded separators", () => {
    for (const path of [["..", "OPEN_INTERACTIVE_READER.html"], ["%2e%2e", "LICENSE.txt"], ["Prompt_Library/P01.txt"], ["unknown.html"], ["", "LICENSE.txt"]]) expect(previewPath(path)).toBeNull();
    expect(previewPath(["Prompt_Library", "P01.txt"])).toBe("Prompt_Library/P01.txt");
  });
  it("requires a complete approved upload before returning any content", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.get.mockResolvedValue(null);
    const result = await GET(request(), context(["OPEN_INTERACTIVE_READER.html"]));
    expect(result.status).toBe(404);
    expect(mocks.getWithMetadata).not.toHaveBeenCalled();
  });
  it("checks the stored file fingerprint and refuses mismatched content", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getWithMetadata.mockResolvedValue({ data: new ArrayBuffer(0), metadata: { sha256: "wrong" } });
    expect((await GET(request(), context(["OPEN_INTERACTIVE_READER.html"]))).status).toBe(404);
  });
  it("serves authenticated HTML without CDN caching or network-capable scripts", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getWithMetadata.mockResolvedValue({ data: new TextEncoder().encode("approved test body").buffer, metadata: { sha256: PREVIEW_FILES["OPEN_INTERACTIVE_READER.html"].sha256 } });
    const result = await GET(request(), context(["OPEN_INTERACTIVE_READER.html"]));
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("Netlify-CDN-Cache-Control")).toBe("no-store");
    expect(result.headers.get("Vary")).toBe("Cookie");
    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(result.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(result.headers.get("Content-Security-Policy")).not.toContain("script-src 'unsafe-inline'");
    expect(mocks.getWithMetadata).toHaveBeenCalledWith(PREVIEW_PREFIX + "OPEN_INTERACTIVE_READER.html", { type: "arrayBuffer" });
  });
  it("retains authenticated relative-path spreadsheet downloads", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getWithMetadata.mockResolvedValue({ data: new ArrayBuffer(0), metadata: { sha256: PREVIEW_FILES["Templates/Study_Toolkit.xlsx"].sha256 } });
    const result = await GET(request(), context(["Templates", "Study_Toolkit.xlsx"]));
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Disposition")).toBe('attachment; filename="Study_Toolkit.xlsx"');
  });
  it("requires same-origin owner authentication to upload", async () => {
    const foreign = new Request("https://books.example.com/api/admin/student-preview", { method: "POST", headers: { origin: "https://elsewhere.example" } });
    expect((await POST(foreign)).status).toBe(403);
    const anonymous = new Request("https://books.example.com/api/admin/student-preview", { method: "POST", headers: { origin: "https://books.example.com" } });
    expect((await POST(anonymous)).status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("refuses incomplete or changed packages before writing", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    const data = new FormData();
    data.append("files", new File(["unapproved"], "OPEN_INTERACTIVE_READER.html"));
    const result = await POST(new Request("https://books.example.com/api/admin/student-preview", { method: "POST", headers: { origin: "https://books.example.com" }, body: data }));
    expect(result.status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects oversized uploads before parsing files", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    const result = await POST(new Request("https://books.example.com/api/admin/student-preview", { method: "POST", headers: { origin: "https://books.example.com", "content-length": String(5 * 1024 * 1024) } }));
    expect(result.status).toBe(413);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
