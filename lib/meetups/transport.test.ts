import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auth", () => ({ resolveApiUser: auth }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUserRecord: auth }));
vi.mock("@/lib/meetups/commands", () => ({ saveMeetupCommand: save }));
import { POST, PATCH } from "@/app/api/meetups/route";
import { saveMeetupAction } from "@/app/(app)/meetup-actions";
const id = "10000000-0000-4000-8000-000000000001";
beforeEach(() => { auth.mockReset(); save.mockReset().mockResolvedValue({ ok: true, message: "Saved" }); });
describe("Meet Up authentication boundaries", () => {
  it("rejects unauthenticated native mutations", async () => {
    auth.mockResolvedValue(null);
    expect((await POST(new Request("https://example.com/api/meetups", { method: "POST" }))).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it("gets the actor from verified native authentication, never the JSON body", async () => {
    auth.mockResolvedValue({ user: { id } });
    const body = { creatorId: "forged" };
    expect((await PATCH(new Request("https://example.com/api/meetups", { method: "PATCH", body: JSON.stringify(body) }))).status).toBe(200);
    expect(save).toHaveBeenCalledWith(id, body, false);
  });
  it("gets the actor from fresh web authentication", async () => {
    auth.mockResolvedValue({ id });
    await saveMeetupAction({ requestKey: id }, true);
    expect(save).toHaveBeenCalledWith(id, { requestKey: id }, true);
  });
  it("rejects a signed-out web action before reaching privileged code", async () => {
    auth.mockResolvedValue(null);
    expect((await saveMeetupAction({})).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
