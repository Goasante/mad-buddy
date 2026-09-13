import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The native notifications transport.
 *
 * It talks to the SAME server as the web client but through different routes
 * and a different credential, so these tests pin the shapes the route handlers
 * actually accept. Getting one wrong fails silently on a phone and nowhere
 * else -- the class of defect that made the whole API layer break unnoticed.
 */

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("./api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), del: (...a: unknown[]) => del(...a) } }));

const { mobileNotificationsClient: client } = await import("./notifications-client");

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
});

describe("loading", () => {
  it("asks for a bounded page", async () => {
    get.mockResolvedValue({ ok: true, data: { notifications: [{ id: "n1" }] } });
    await expect(client.load()).resolves.toEqual([{ id: "n1" }]);
    expect(get).toHaveBeenCalledWith("/api/notifications?limit=50");
  });

  it("resolves null when the request fails", async () => {
    get.mockResolvedValue({ ok: false, error: "Network error.", status: 0 });
    await expect(client.load()).resolves.toBeNull();
  });

  it("tolerates a response with no notifications field", async () => {
    get.mockResolvedValue({ ok: true, data: {} });
    await expect(client.load()).resolves.toEqual([]);
  });
});

describe("read state uses POST /api/notifications, not the web PATCH route", () => {
  it("marks all read", async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await expect(client.markAllRead()).resolves.toEqual({ ok: true, message: undefined });
    expect(post).toHaveBeenCalledWith("/api/notifications", { markAllRead: true });
  });

  it("marks one read by id", async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await client.markRead("n1");
    expect(post).toHaveBeenCalledWith("/api/notifications", { ids: ["n1"], isRead: true });
  });

  it("marks a selection UNREAD, which the route supports explicitly", async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await client.setReadState(["a", "b"], false);
    expect(post).toHaveBeenCalledWith("/api/notifications", { ids: ["a", "b"], isRead: false });
  });

  it("passes the failure message through", async () => {
    post.mockResolvedValue({ ok: false, error: "You are signed out.", status: 401 });
    await expect(client.markAllRead()).resolves.toEqual({ ok: false, message: "You are signed out." });
  });
});

describe("deleting", () => {
  it("reports the ids the server removed", async () => {
    del.mockResolvedValue({ ok: true, data: { deletedIds: ["a"] } });
    await expect(client.remove(["a"])).resolves.toEqual({ ok: true, deletedIds: ["a"] });
    expect(del).toHaveBeenCalledWith("/api/notifications", { ids: ["a"] });
  });

  it("reports nothing deleted when the call fails", async () => {
    del.mockResolvedValue({ ok: false, error: "nope", status: 500 });
    await expect(client.remove(["a", "b"])).resolves.toEqual({ ok: false, deletedIds: [] });
  });
});

describe("actions reach the routes the web Server Actions share", () => {
  it("replies to a ping through /api/pings/respond", async () => {
    // Same service module as respondToMeetupRequestAction, so the premium gate
    // and friendship check cannot differ between the two apps.
    post.mockResolvedValue({ ok: true, data: { ok: true, message: "Reply sent." } });
    await expect(client.respondToPing("req-1", "See you at six")).resolves.toEqual({
      ok: true,
      message: "Reply sent."
    });
    expect(post).toHaveBeenCalledWith("/api/pings/respond", { requestId: "req-1", message: "See you at six" });
  });

  it("reports a refusal the SERVER made, not just a transport failure", async () => {
    // HTTP 200 with ok:false is how the route declines a reply (not your ping,
    // no longer Muddies, not on Mad Buddy). The message must survive.
    post.mockResolvedValue({ ok: true, data: { ok: false, message: "You are no longer connected with this Muddy." } });
    await expect(client.respondToPing("req-1", "hi there")).resolves.toEqual({
      ok: false,
      message: "You are no longer connected with this Muddy."
    });
  });

  it("sends a birthday wish", async () => {
    post.mockResolvedValue({ ok: true, data: { ok: true, message: "Birthday wish sent" } });
    await expect(client.sendBirthdayWish("user-1", "Happy birthday!")).resolves.toEqual({
      ok: true,
      message: "Birthday wish sent"
    });
    expect(post).toHaveBeenCalledWith("/api/birthdays/wish", { targetUserId: "user-1", wish: "Happy birthday!" });
  });

  it("falls back to the transport error when the call never landed", async () => {
    post.mockResolvedValue({ ok: false, error: "Network error. Check your connection.", status: 0 });
    await expect(client.sendBirthdayWish("user-1", "Happy birthday!")).resolves.toEqual({
      ok: false,
      message: "Network error. Check your connection."
    });
  });
});
