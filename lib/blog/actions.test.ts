import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), rpc: vi.fn(), audit: vi.fn(), rate: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/blog/admin", () => ({ blogOwnerContext: mocks.owner }));
vi.mock("@/lib/admin/service", () => ({ recordAdminAuditEvent: mocks.audit }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate, rateLimitMessage: () => "Rate limited" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { saveArticleAction } from "@/app/(admin)/admin/blog/actions";
import { starterArticles } from "./starter-articles";
const id = "4d8d6b75-7b43-4cb7-9c53-8a1bc5871ed3";
const input = { id, version: 1, article: starterArticles[0], intent: "publish" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue({ admin: { rpc: mocks.rpc }, context: { userId: id } });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.audit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { id, version: 2, live: true }, error: null });
});
describe("owner publishing action", () => {
  it("denies a non-owner before any mutation", async () => {
    mocks.owner.mockResolvedValue(null);
    expect((await saveArticleAction(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("refuses unfinished publication", async () => {
    expect((await saveArticleAction({ ...input, article: { ...input.article, body: "TODO" } })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed if audit logging fails", async () => {
    mocks.audit.mockResolvedValue(false);
    expect((await saveArticleAction(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("enforces rate limits", async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect((await saveArticleAction(input)).message).toBe("Rate limited");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends the expected version to the atomic RPC and refreshes search surfaces", async () => {
    expect((await saveArticleAction(input)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("save_blog_post", expect.objectContaining({ p_version: 1, p_intent: "publish", p_actor: id }));
    expect(mocks.refresh).toHaveBeenCalledWith("/sitemap.xml");
  });
  it("preserves user text on a stale-editor failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Version conflict: reload before saving" } });
    expect((await saveArticleAction(input)).message).toContain("copy your text first");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
