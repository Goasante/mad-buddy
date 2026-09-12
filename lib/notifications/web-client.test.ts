import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebNotificationsClient } from "./web-client";

/**
 * The web notifications transport.
 *
 * These calls used to sit inline in NotificationsPageContent. Moving them out
 * is what lets Android render the same screen, so this file pins that the MOVE
 * changed nothing: same endpoints, same methods, same bodies.
 *
 * The subtle one is delete. The route answers 409 with a PARTIAL deletedIds
 * list when some rows could not be removed, and the screen restores exactly the
 * rows the server kept. A client that reported only ok/failed would leave the
 * list disagreeing with the database until a reload.
 */

const actions = {
  respondToPing: vi.fn(async () => ({ ok: true })),
  sendBirthdayWish: vi.fn(async () => ({ ok: true }))
};

const client = createWebNotificationsClient(actions);

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const okJson = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("loading", () => {
  it("reads the notifications array", async () => {
    mockFetch(okJson({ notifications: [{ id: "n1" }] }));
    await expect(client.load()).resolves.toEqual([{ id: "n1" }]);
  });

  it("sends the session cookie and refuses a cached answer", async () => {
    const fetchMock = mockFetch(okJson({ notifications: [] }));
    await client.load();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notifications");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("resolves null rather than throwing when the request fails", async () => {
    // A throw here would unmount the screen instead of showing a message.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(client.load()).resolves.toBeNull();
  });

  it("resolves null on a non-ok response", async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({}) });
    await expect(client.load()).resolves.toBeNull();
  });
});

describe("marking read", () => {
  it("marks all read with an empty body", async () => {
    const fetchMock = mockFetch(okJson({}));
    await expect(client.markAllRead()).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notifications/read");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("marks one row read by id", async () => {
    const fetchMock = mockFetch(okJson({}));
    await client.markRead("n1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ notificationId: "n1" });
  });

  it("carries the read state for a selection, including unread", async () => {
    const fetchMock = mockFetch(okJson({}));
    await client.setReadState(["a", "b"], false);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ ids: ["a", "b"], isRead: false });
  });

  it("reports failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(client.markAllRead()).resolves.toEqual({ ok: false });
    await expect(client.setReadState(["a"], true)).resolves.toEqual({ ok: false });
  });
});

describe("deleting", () => {
  it("returns the ids the server actually removed", async () => {
    mockFetch(okJson({ deletedIds: ["a", "b"] }));
    await expect(client.remove(["a", "b"])).resolves.toEqual({ ok: true, deletedIds: ["a", "b"] });
  });

  it("surfaces a PARTIAL delete, which the route reports as 409", async () => {
    // THE CASE THAT MATTERS: two asked for, one removed. The caller needs to
    // know which survived so it can put that row back.
    mockFetch({ ok: false, status: 409, json: async () => ({ deletedIds: ["a"] }) });
    await expect(client.remove(["a", "b"])).resolves.toEqual({ ok: false, deletedIds: ["a"] });
  });

  it("treats a missing deletedIds list as nothing deleted", async () => {
    mockFetch(okJson({}));
    await expect(client.remove(["a"])).resolves.toEqual({ ok: true, deletedIds: [] });
  });

  it("survives a body that is not JSON", async () => {
    mockFetch({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    await expect(client.remove(["a"])).resolves.toEqual({ ok: false, deletedIds: [] });
  });
});

describe("actions stay injected", () => {
  it("does not implement the Server Actions itself", async () => {
    // Importing them here would pull "use server" modules into every bundle
    // that touches this file, including the mobile one.
    await client.respondToPing("req-1", "See you at six");
    expect(actions.respondToPing).toHaveBeenCalledWith("req-1", "See you at six");
    await client.sendBirthdayWish("user-1", "Happy birthday!");
    expect(actions.sendBirthdayWish).toHaveBeenCalledWith("user-1", "Happy birthday!");
  });
});
