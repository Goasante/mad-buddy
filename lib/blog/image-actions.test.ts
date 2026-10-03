import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), audit: vi.fn(), rate: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/blog/admin", () => ({ blogOwnerContext: mocks.auth }));
vi.mock("@/lib/admin/service", () => ({ recordAdminAuditEvent: mocks.audit }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate, rateLimitMessage: () => "Try later" }));
vi.mock("@/lib/blog/image-service", () => ({ uploadJournalImage: mocks.upload }));
import { uploadArticleImageAction } from "@/app/(admin)/admin/blog/image-actions";
function form() { const data = new FormData(); data.set("image", new File(["image"], "photo.jpg", { type: "image/jpeg" })); return data; }
describe("journal image upload authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ admin: {}, context: { userId: "owner" } }); mocks.rate.mockResolvedValue({ allowed: true }); mocks.audit.mockResolvedValue(true); mocks.upload.mockResolvedValue({ ok: true }); });
  it("denies non-owners before processing", async () => { mocks.auth.mockResolvedValue(null); expect((await uploadArticleImageAction(form())).ok).toBe(false); expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("denies missing images", async () => { expect((await uploadArticleImageAction(new FormData())).ok).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("denies uploads when rate limited", async () => { mocks.rate.mockResolvedValue({ allowed: false }); expect((await uploadArticleImageAction(form())).ok).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("fails closed if the audit record fails", async () => { mocks.audit.mockResolvedValue(false); expect((await uploadArticleImageAction(form())).ok).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); });
  it("processes an authorized, audited upload", async () => { expect((await uploadArticleImageAction(form())).ok).toBe(true); expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.upload.mock.calls[0][1]).toBe("owner"); });
});
