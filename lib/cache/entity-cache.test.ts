import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPIRES_AFTER_MS,
  DEFAULT_STALE_AFTER_MS,
  EntityCache,
  cacheKeys,
  invalidateForAuthorizationChange,
  invalidateProfile
} from "@/lib/cache/entity-cache";
import { ImageRequestMap, SIGNED_URL_LIFETIME_MS } from "@/lib/cache/image-requests";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const WINDOWS = { staleAfterMs: 30_000, expiresAfterMs: 300_000 };

let cache: EntityCache;
beforeEach(() => {
  cache = new EntityCache();
});

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

describe("entry states", () => {
  it("is fresh inside its freshness window", () => {
    cache.set("k", { a: 1 }, { ...WINDOWS, now: NOW });
    expect(cache.stateOf("k", NOW + 10_000)).toBe("fresh");
    expect(cache.get("k", NOW + 10_000)).toEqual({ a: 1 });
  });

  it("becomes stale but still renders", () => {
    cache.set("k", { a: 1 }, { ...WINDOWS, now: NOW });
    expect(cache.stateOf("k", NOW + 60_000)).toBe("stale");
    // Stale data is the whole point: it prevents a blank screen on reopen.
    expect(cache.get("k", NOW + 60_000)).toEqual({ a: 1 });
  });

  it("expires and stops rendering", () => {
    cache.set("k", { a: 1 }, { ...WINDOWS, now: NOW });
    expect(cache.stateOf("k", NOW + 400_000)).toBe("expired");
    expect(cache.get("k", NOW + 400_000)).toBeNull();
  });

  it("treats a missing entry as expired", () => {
    expect(cache.stateOf("absent", NOW)).toBe("expired");
    expect(cache.get("absent", NOW)).toBeNull();
  });

  it("drops an expired entry rather than keeping it in memory", () => {
    cache.set("k", { a: 1 }, { ...WINDOWS, now: NOW });
    cache.get("k", NOW + 400_000);
    expect(cache.size).toBe(0);
  });

  it("keeps its default windows short", () => {
    // This cache exists to avoid blank screens, not to retain data.
    expect(DEFAULT_STALE_AFTER_MS).toBeLessThanOrEqual(60_000);
    expect(DEFAULT_EXPIRES_AFTER_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(DEFAULT_STALE_AFTER_MS).toBeLessThan(DEFAULT_EXPIRES_AFTER_MS);
  });
});

// ---------------------------------------------------------------------------
// Stale-while-revalidate
// ---------------------------------------------------------------------------

describe("read-through", () => {
  it("does not refetch while fresh", async () => {
    const fetcher = vi.fn().mockResolvedValue("v2");
    cache.set("k", "v1", { ...WINDOWS, now: NOW });
    await expect(cache.read("k", fetcher, { ...WINDOWS, now: NOW + 1_000 })).resolves.toBe("v1");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns stale data immediately and revalidates behind it", async () => {
    const fetcher = vi.fn().mockResolvedValue("v2");
    cache.set("k", "v1", { ...WINDOWS, now: NOW });

    // The caller gets the cached value without waiting.
    await expect(cache.read("k", fetcher, { ...WINDOWS, now: NOW + 60_000 })).resolves.toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The refresh lands afterwards.
    await vi.waitFor(() => expect(cache.get("k", NOW + 61_000)).toBe("v2"));
  });

  it("awaits a real fetch when expired", async () => {
    const fetcher = vi.fn().mockResolvedValue("fresh");
    await expect(cache.read("k", fetcher, { ...WINDOWS, now: NOW })).resolves.toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps stale data when revalidation fails", async () => {
    cache.set("k", "v1", { ...WINDOWS, now: NOW });
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    await expect(cache.read("k", fetcher, { ...WINDOWS, now: NOW + 60_000 })).resolves.toBe("v1");
    // A failed refresh must not blank the screen.
    await vi.waitFor(() => expect(cache.isInFlight("k")).toBe(false));
    expect(cache.get("k", NOW + 61_000)).toBe("v1");
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("request deduplication", () => {
  it("issues one request for concurrent callers", async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((resolve) => (resolveFetch = resolve)));

    const a = cache.read("k", fetcher, { ...WINDOWS, now: NOW });
    const b = cache.read("k", fetcher, { ...WINDOWS, now: NOW });
    const c = cache.read("k", fetcher, { ...WINDOWS, now: NOW });
    expect(cache.isInFlight("k")).toBe(true);

    resolveFetch("value");
    await expect(Promise.all([a, b, c])).resolves.toEqual(["value", "value", "value"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight record afterwards", async () => {
    await cache.read("k", () => Promise.resolve("v"), { ...WINDOWS, now: NOW });
    expect(cache.isInFlight("k")).toBe(false);
  });

  it("clears it after a failure too", async () => {
    await expect(
      cache.read("k", () => Promise.reject(new Error("nope")), { ...WINDOWS, now: NOW })
    ).rejects.toThrow();
    expect(cache.isInFlight("k")).toBe(false);
  });

  it("keeps separate keys independent", async () => {
    const one = vi.fn().mockResolvedValue(1);
    const two = vi.fn().mockResolvedValue(2);
    await Promise.all([
      cache.read("a", one, { ...WINDOWS, now: NOW }),
      cache.read("b", two, { ...WINDOWS, now: NOW })
    ]);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

describe("invalidation", () => {
  it("drops one entry", () => {
    cache.set("k", "v", { ...WINDOWS, now: NOW });
    cache.invalidate("k");
    expect(cache.get("k", NOW)).toBeNull();
  });

  it("drops a whole family by prefix", () => {
    cache.set("moment:1", "a", { ...WINDOWS, now: NOW });
    cache.set("moment:2", "b", { ...WINDOWS, now: NOW });
    cache.set("profile:kofi", "c", { ...WINDOWS, now: NOW });
    cache.invalidatePrefix("moment:");
    expect(cache.get("moment:1", NOW)).toBeNull();
    expect(cache.get("moment:2", NOW)).toBeNull();
    expect(cache.get("profile:kofi", NOW)).toBe("c");
  });

  it("drops everything on an authorisation change", () => {
    cache.set("a", 1, { ...WINDOWS, now: NOW });
    cache.set("b", 2, { ...WINDOWS, now: NOW });
    cache.invalidateAll();
    expect(cache.size).toBe(0);
    expect(cache.get("a", NOW)).toBeNull();
  });

  it("moves the authorisation version forward", () => {
    const before = cache.version;
    cache.invalidateAll();
    expect(cache.version).toBeGreaterThan(before);
  });

  it("refuses to cache a response authorised under a previous scope", async () => {
    // The block/logout race: a request starts, authorisation changes, the
    // response arrives. It must not be written back.
    let resolveFetch: (value: string) => void = () => {};
    const request = cache.read("k", () => new Promise<string>((r) => (resolveFetch = r)), {
      ...WINDOWS,
      now: NOW
    });

    cache.invalidateAll();
    resolveFetch("stale-authorisation");
    await request;

    expect(cache.get("k", NOW)).toBeNull();
  });

  it("invalidates a profile through the helper", () => {
    cache.set(cacheKeys.profile("kofi"), { name: "Kofi" }, { ...WINDOWS, now: NOW });
    invalidateProfile("kofi", cache);
    expect(cache.get(cacheKeys.profile("kofi"), NOW)).toBeNull();
  });

  it("drops everything when a relationship or privacy setting changes", () => {
    cache.set("a", 1, { ...WINDOWS, now: NOW });
    invalidateForAuthorizationChange(cache);
    expect(cache.size).toBe(0);
  });

  it("namespaces keys so families can be invalidated together", () => {
    expect(cacheKeys.moment("m1")).toBe("moment:m1");
    expect(cacheKeys.profile("kofi")).toBe("profile:kofi");
    expect(cacheKeys.home("u1")).toBe("home:u1");
    expect(cacheKeys.conversations("u1")).toBe("messages:list:u1");
  });
});

// ---------------------------------------------------------------------------
// Image deduplication
// ---------------------------------------------------------------------------

describe("image requests", () => {
  let images: ImageRequestMap;
  beforeEach(() => {
    images = new ImageRequestMap();
  });

  it("downloads one image once across surfaces", async () => {
    const resolver = vi.fn().mockResolvedValue("https://example.test/a.jpg");
    const results = await Promise.all([
      images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW),
      images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW),
      images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW)
    ]);
    expect(new Set(results).size).toBe(1);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("reuses a valid URL without asking again", async () => {
    const resolver = vi.fn().mockResolvedValue("https://example.test/a.jpg");
    await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW);
    await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW + 60_000);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("discards an expired signed URL and requests a fresh one", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce("https://example.test/first.jpg")
      .mockResolvedValueOnce("https://example.test/second.jpg");

    await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW);
    const later = await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW + SIGNED_URL_LIFETIME_MS);

    expect(later).toBe("https://example.test/second.jpg");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("never serves an expired URL as proof of access", () => {
    images.set("media-1", "https://example.test/a.jpg", SIGNED_URL_LIFETIME_MS, NOW);
    expect(images.get("media-1", NOW + SIGNED_URL_LIFETIME_MS)).toBeNull();
    // Dropped, not merely hidden.
    expect(images.size).toBe(0);
  });

  it("expires slightly early so a load cannot fail mid-flight", () => {
    images.set("media-1", "https://example.test/a.jpg", SIGNED_URL_LIFETIME_MS, NOW);
    expect(images.get("media-1", NOW + SIGNED_URL_LIFETIME_MS - 5_000)).toBeNull();
  });

  it("keys on media identity, not the signed URL", async () => {
    // A signed URL changes every mint, so URL keys would defeat dedup.
    const resolver = vi
      .fn()
      .mockResolvedValueOnce("https://example.test/a.jpg?sig=1")
      .mockResolvedValueOnce("https://example.test/a.jpg?sig=2");
    await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW);
    await images.resolve("media-1", resolver, SIGNED_URL_LIFETIME_MS, NOW + 1_000);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("stores no image bytes", () => {
    const source = stripComments(read("lib/cache/image-requests.ts"));
    for (const banned of ["Blob", "ArrayBuffer", "createObjectURL", "caches.open", "indexedDB"]) {
      expect(source, `image map must not use ${banned}`).not.toContain(banned);
    }
  });

  it("clears on demand", () => {
    images.set("media-1", "https://example.test/a.jpg", SIGNED_URL_LIFETIME_MS, NOW);
    images.clear();
    expect(images.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Security boundaries
// ---------------------------------------------------------------------------

describe("security boundaries", () => {
  const cacheSource = stripComments(read("lib/cache/entity-cache.ts"));
  const bindingSource = stripComments(read("lib/cache/session-binding.ts"));

  it("keeps everything in memory", () => {
    for (const banned of ["localStorage", "sessionStorage", "indexedDB", "caches.open", "document.cookie"]) {
      expect(cacheSource, `cache must not use ${banned}`).not.toContain(banned);
    }
  });

  it("stores no tokens, locations or media", () => {
    for (const banned of ["token", "latitude", "longitude", "accessToken", "Blob"]) {
      expect(cacheSource, `cache must not store ${banned}`).not.toContain(banned);
    }
  });

  it("reuses the existing session broadcast rather than a second logout path", () => {
    expect(bindingSource).toContain("subscribeToSessionEnd");
    expect(bindingSource).toContain("appCache.invalidateAll()");
    expect(bindingSource).toContain("imageRequests.clear()");
  });

  it("treats an account switch exactly like a logout", () => {
    expect(bindingSource).toContain("clearAllClientCaches();");
    // Behaviour, not wording — asserted directly below.
    expect(bindingSource).toContain("export function syncCachesToUser");
  });

  it("leaves the service worker network-only", () => {
    // The guard the caching brief explicitly preserves.
    const worker = read("public/sw.js");
    expect(worker).toContain("network-only-v2");
    expect(worker).not.toMatch(/\bcaches\.(?:open|match|put|delete)\b/);
  });

  it("adds no service-worker caching from the client either", () => {
    expect(cacheSource).not.toContain("serviceWorker");
    expect(bindingSource).not.toContain("serviceWorker");
  });
});

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

describe("offline reads", () => {
  it("still renders metadata inside its authorised lifetime", () => {
    // Offline is read-only in this phase: cached metadata within its window
    // is safe to show.
    cache.set("home:u1", { sections: 4 }, { ...WINDOWS, now: NOW });
    expect(cache.get("home:u1", NOW + 60_000)).toEqual({ sections: 4 });
  });

  it("stops rendering once the lifetime passes, offline or not", () => {
    // Being offline is never a reason to keep showing expired data.
    cache.set("home:u1", { sections: 4 }, { ...WINDOWS, now: NOW });
    expect(cache.get("home:u1", NOW + 400_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session binding behaviour
// ---------------------------------------------------------------------------

describe("session binding", () => {
  it("clears both caches when the session ends", async () => {
    const { appCache } = await import("@/lib/cache/entity-cache");
    const { imageRequests } = await import("@/lib/cache/image-requests");
    const { clearAllClientCaches } = await import("@/lib/cache/session-binding");

    appCache.set("k", "v", { ...WINDOWS, now: NOW });
    imageRequests.set("media-1", "https://example.test/a.jpg", SIGNED_URL_LIFETIME_MS, NOW);

    clearAllClientCaches();

    expect(appCache.size).toBe(0);
    expect(imageRequests.size).toBe(0);
  });

  it("clears when the account changes, but not on a repeat of the same user", async () => {
    const { appCache } = await import("@/lib/cache/entity-cache");
    const { syncCachesToUser, resetCacheUserBinding } = await import("@/lib/cache/session-binding");

    resetCacheUserBinding();
    syncCachesToUser("user-a");

    appCache.set("k", "v", { ...WINDOWS, now: NOW });
    // Same user again: the cache must survive.
    syncCachesToUser("user-a");
    expect(appCache.get("k", NOW)).toBe("v");

    // A different account must never see the previous one's data.
    syncCachesToUser("user-b");
    expect(appCache.get("k", NOW)).toBeNull();
  });

  it("clears on sign-out, when the user becomes null", async () => {
    const { appCache } = await import("@/lib/cache/entity-cache");
    const { syncCachesToUser, resetCacheUserBinding } = await import("@/lib/cache/session-binding");

    resetCacheUserBinding();
    syncCachesToUser("user-a");
    appCache.set("k", "v", { ...WINDOWS, now: NOW });

    syncCachesToUser(null);
    expect(appCache.get("k", NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe("cache metrics", () => {
  it("starts at zero", () => {
    expect(cache.metrics()).toEqual({
      hits: 0,
      misses: 0,
      staleReads: 0,
      expiredReads: 0,
      revalidations: 0,
      dedupedRequests: 0,
      evictions: 0,
      entries: 0
    });
  });

  it("counts a fresh hit", () => {
    cache.set("k", "v", { ...WINDOWS, now: NOW });
    cache.get("k", NOW + 1_000);
    expect(cache.metrics().hits).toBe(1);
    expect(cache.metrics().misses).toBe(0);
  });

  it("counts a stale read as both a hit and a stale read", () => {
    cache.set("k", "v", { ...WINDOWS, now: NOW });
    cache.get("k", NOW + 60_000);
    expect(cache.metrics().hits).toBe(1);
    expect(cache.metrics().staleReads).toBe(1);
  });

  it("distinguishes an expired entry from one that was never there", () => {
    cache.set("k", "v", { ...WINDOWS, now: NOW });
    cache.get("k", NOW + 400_000);
    cache.get("never-stored", NOW);
    expect(cache.metrics().expiredReads).toBe(1);
    expect(cache.metrics().misses).toBe(1);
  });

  it("counts revalidations behind stale reads", async () => {
    cache.set("k", "v1", { ...WINDOWS, now: NOW });
    await cache.read("k", () => Promise.resolve("v2"), { ...WINDOWS, now: NOW + 60_000 });
    expect(cache.metrics().revalidations).toBe(1);
  });

  it("counts the requests deduplication saved", async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetcher = () => new Promise<string>((resolve) => (resolveFetch = resolve));
    const all = Promise.all([
      cache.read("k", fetcher, { ...WINDOWS, now: NOW }),
      cache.read("k", fetcher, { ...WINDOWS, now: NOW }),
      cache.read("k", fetcher, { ...WINDOWS, now: NOW })
    ]);
    resolveFetch("v");
    await all;
    // Three callers, one request: two were saved.
    expect(cache.metrics().dedupedRequests).toBe(2);
  });

  it("reports the live entry count", () => {
    cache.set("a", 1, { ...WINDOWS, now: NOW });
    cache.set("b", 2, { ...WINDOWS, now: NOW });
    expect(cache.metrics().entries).toBe(2);
  });

  it("resets on demand without touching the entries", () => {
    cache.set("k", "v", { ...WINDOWS, now: NOW });
    cache.get("k", NOW);
    cache.resetMetrics();
    expect(cache.metrics().hits).toBe(0);
    expect(cache.metrics().entries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Optional LRU
// ---------------------------------------------------------------------------

describe("optional LRU", () => {
  it("is disabled by default — nothing is evicted", () => {
    for (let i = 0; i < 50; i += 1) cache.set(`k${i}`, i, { ...WINDOWS, now: NOW });
    expect(cache.size).toBe(50);
    expect(cache.metrics().evictions).toBe(0);
  });

  it("evicts the least recently used once enabled", () => {
    const bounded = new EntityCache({ maxEntries: 3 });
    bounded.set("a", 1, { ...WINDOWS, now: NOW });
    bounded.set("b", 2, { ...WINDOWS, now: NOW });
    bounded.set("c", 3, { ...WINDOWS, now: NOW });
    bounded.set("d", 4, { ...WINDOWS, now: NOW });

    expect(bounded.size).toBe(3);
    // "a" was the oldest and untouched.
    expect(bounded.get("a", NOW)).toBeNull();
    expect(bounded.get("d", NOW)).toBe(4);
    expect(bounded.metrics().evictions).toBe(1);
  });

  it("spares an entry that was recently read", () => {
    const bounded = new EntityCache({ maxEntries: 3 });
    bounded.set("a", 1, { ...WINDOWS, now: NOW });
    bounded.set("b", 2, { ...WINDOWS, now: NOW });
    bounded.set("c", 3, { ...WINDOWS, now: NOW });

    // Reading "a" makes it the most recently used, so "b" goes instead.
    bounded.get("a", NOW);
    bounded.set("d", 4, { ...WINDOWS, now: NOW });

    expect(bounded.get("a", NOW)).toBe(1);
    expect(bounded.get("b", NOW)).toBeNull();
  });

  it("can be switched on and off at runtime", () => {
    const bounded = new EntityCache();
    for (let i = 0; i < 10; i += 1) bounded.set(`k${i}`, i, { ...WINDOWS, now: NOW });
    expect(bounded.size).toBe(10);

    bounded.setMaxEntries(4);
    expect(bounded.size).toBe(4);

    // 0 disables it again.
    bounded.setMaxEntries(0);
    for (let i = 10; i < 20; i += 1) bounded.set(`k${i}`, i, { ...WINDOWS, now: NOW });
    expect(bounded.size).toBe(14);
  });

  it("leaves behaviour identical when disabled", () => {
    const unbounded = new EntityCache({ maxEntries: 0 });
    unbounded.set("k", "v", { ...WINDOWS, now: NOW });
    expect(unbounded.get("k", NOW)).toBe("v");
    expect(unbounded.metrics().evictions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

describe("Home cache wiring", () => {
  const home = read("components/dashboard/dashboard-page.tsx");
  const shell = read("components/app-shell/app-shell.tsx");

  it("routes Near through the canonical cache", () => {
    expect(home).toContain("appCache.read<NearbyFriendApiItem[]>(");
    expect(home).toContain("cacheKeys.homeNearby()");
  });

  it("builds no second cache inside Home", () => {
    // The hand-rolled in-flight ref this replaced is gone.
    expect(home).not.toContain("nearbyRefreshRef");
    expect(home).not.toContain("new Map<");
    expect(home).not.toContain("class ");
  });

  it("keeps the Near window short", () => {
    // A nearby rail minutes old must not be presented as current.
    expect(home).toContain("staleAfterMs: 30_000, expiresAfterMs: 3 * 60_000");
  });

  it("never blanks Home when a refresh fails", () => {
    const loader = home.slice(home.indexOf("const loadNearbyFriends"), home.indexOf("usePullRefreshListener(loadNearbyFriends)"));
    expect(loader).toContain(".catch((error: unknown) => {");
    // The failure path only sets a message; it never clears the rendered rail.
    expect(loader).not.toContain("setFriends([])");
  });

  it("surfaces no raw server error", () => {
    const loader = home.slice(home.indexOf("const loadNearbyFriends"), home.indexOf("usePullRefreshListener(loadNearbyFriends)"));
    expect(loader).toContain("Could not reach the nearby friends service.");
    expect(loader).not.toContain("error.stack");
    expect(loader).not.toContain("JSON.stringify(error");
  });

  it("clears the caches on logout from the shell", () => {
    expect(shell).toContain("bindCachesToSession");
    expect(shell).toContain("useEffect(() => bindCachesToSession(), [])");
  });
});
