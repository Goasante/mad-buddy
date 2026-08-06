/**
 * The canonical client cache.
 *
 * ONE implementation for every screen — Home, Moments, Profiles, Messages —
 * so there is no per-screen cache to keep in step and no second place where
 * an expiry or invalidation rule could be forgotten.
 *
 * Deliberate boundaries, per the caching brief:
 *
 *  - IN MEMORY ONLY. Nothing here writes to Cache Storage, localStorage or
 *    IndexedDB, so private data cannot outlive the tab and the service worker
 *    stays network-only. A page reload starts cold, which is the correct
 *    trade for a device that may be shared.
 *  - THE SERVER ALWAYS WINS. An entry is a rendering shortcut, never proof of
 *    access. Anything past its authorised lifetime stops being renderable,
 *    and an authorisation change drops it immediately.
 *  - NO TOKENS, NO LOCATIONS, NO MEDIA BYTES. Callers cache lightweight
 *    metadata; this module never fetches or stores media itself.
 *
 * THE ARCHITECTURAL RULE
 * ----------------------
 * The cache is an OPTIMISATION, never a source of truth.
 *
 * Every consumer follows:
 *
 *     cache → immediate render → silent validation → server decides
 *
 * and never:
 *
 *     cache → truth
 *
 * A cached value exists to avoid a blank frame while the real answer is on
 * its way. It is never evidence that the viewer may still see something: only
 * the server decides that, and anything past its authorised lifetime stops
 * being renderable regardless of what is held here.
 */

/** How an entry may be used right now. */
export type CacheEntryState =
  /** Within its freshness window: render and do not refetch. */
  | "fresh"
  /** Past freshness but inside its authorised lifetime: render, and revalidate. */
  | "stale"
  /** Past its authorised lifetime or invalidated: must not render. */
  | "expired";

export type CacheEntry<T> = {
  key: string;
  data: T;
  fetchedAt: number;
  /** When this stops being renderable at all. */
  expiresAt: number;
  /** When it stops being fresh and should be revalidated behind the scenes. */
  staleAt: number;
  /**
   * The authorisation this entry was fetched under. When the current version
   * moves on — logout, account switch, block, privacy change — every entry
   * carrying an older version is unusable, with no need to know which key it
   * was stored under.
   */
  authorizationVersion: number;
};

export type CacheSetOptions = {
  /** Milliseconds until the entry stops being fresh. */
  staleAfterMs: number;
  /** Milliseconds until it stops being renderable. Must exceed staleAfterMs. */
  expiresAfterMs: number;
  now?: number;
};

/**
 * Default windows for lightweight authorised metadata.
 *
 * Short by design: this cache exists to avoid a blank screen on reopen, not
 * to keep data around. Anything needing a longer life is not metadata.
 */
export const DEFAULT_STALE_AFTER_MS = 30 * 1000;
export const DEFAULT_EXPIRES_AFTER_MS = 5 * 60 * 1000;

/**
 * Development-only counters.
 *
 * Enough to answer "is the cache actually helping?" — hit rate, how often a
 * render was served stale, how many requests deduplication saved. Never shown
 * in production UI and never logged on a timer.
 */
export type CacheMetrics = {
  hits: number;
  misses: number;
  staleReads: number;
  expiredReads: number;
  revalidations: number;
  dedupedRequests: number;
  evictions: number;
  entries: number;
};

export type EntityCacheOptions = {
  /**
   * Maximum entries before least-recently-used eviction.
   *
   * Off by default: with short lifetimes and metadata-only entries the map
   * stays small on its own, and an unnecessary cap risks evicting something a
   * screen is about to read. The support exists so it can be switched on if a
   * consumer ever caches per-scroll-page data.
   */
  maxEntries?: number;
};

export class EntityCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  /** Bumped on every invalidation, so stored entries fall out of scope. */
  private authorizationVersion = 1;
  private maxEntries: number;
  private counters = {
    hits: 0,
    misses: 0,
    staleReads: 0,
    expiredReads: 0,
    revalidations: 0,
    dedupedRequests: 0,
    evictions: 0
  };

  constructor(options: EntityCacheOptions = {}) {
    // 0 or undefined means unbounded — the default.
    this.maxEntries = options.maxEntries ?? 0;
  }

  /** Turn LRU eviction on or off at runtime. 0 disables it. */
  setMaxEntries(maxEntries: number): void {
    this.maxEntries = maxEntries;
    this.evictIfNeeded();
  }

  /** A snapshot of the counters, plus the live entry count. */
  metrics(): CacheMetrics {
    return { ...this.counters, entries: this.entries.size };
  }

  resetMetrics(): void {
    this.counters = {
      hits: 0,
      misses: 0,
      staleReads: 0,
      expiredReads: 0,
      revalidations: 0,
      dedupedRequests: 0,
      evictions: 0
    };
  }

  /**
   * Evict least-recently-used entries once over the cap.
   *
   * Map preserves insertion order, and every read re-inserts, so the first
   * key is always the least recently used.
   */
  private evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.counters.evictions += 1;
    }
  }

  /** Move a key to the most-recently-used position. */
  private touch(key: string): void {
    if (this.maxEntries <= 0) return;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** The current authorisation scope. Entries below this are unusable. */
  get version(): number {
    return this.authorizationVersion;
  }

  /**
   * Classify an entry.
   *
   * A missing entry, one from a previous authorisation scope, or one past its
   * lifetime are all "expired" — the caller cannot tell them apart, and must
   * not render any of them.
   */
  stateOf(key: string, now = Date.now()): CacheEntryState {
    const entry = this.entries.get(key);
    if (!entry) return "expired";
    if (entry.authorizationVersion !== this.authorizationVersion) return "expired";
    if (now >= entry.expiresAt) return "expired";
    return now >= entry.staleAt ? "stale" : "fresh";
  }

  /**
   * Read an entry that is safe to render.
   *
   * Returns null for anything expired or out of scope, so an expired value can
   * never reach a screen by accident. Callers wanting to know whether it was
   * fresh or stale ask `stateOf` alongside.
   */
  get<T>(key: string, now = Date.now()): T | null {
    const state = this.stateOf(key, now);
    if (state === "expired") {
      // Drop it on read: an unusable entry should not occupy memory or be
      // observable through `size`.
      const existed = this.entries.delete(key);
      if (existed) this.counters.expiredReads += 1;
      else this.counters.misses += 1;
      return null;
    }

    if (state === "stale") this.counters.staleReads += 1;
    this.counters.hits += 1;
    this.touch(key);
    return (this.entries.get(key)?.data as T) ?? null;
  }

  /** Store an entry under the CURRENT authorisation scope. */
  set<T>(key: string, data: T, options: CacheSetOptions): void {
    const now = options.now ?? Date.now();
    this.entries.set(key, {
      key,
      data,
      fetchedAt: now,
      staleAt: now + options.staleAfterMs,
      expiresAt: now + options.expiresAfterMs,
      authorizationVersion: this.authorizationVersion
    });
    this.evictIfNeeded();
  }

  /**
   * Read-through with stale-while-revalidate and request deduplication.
   *
   * - fresh: returns the cached value, no request.
   * - stale: returns the cached value AND revalidates in the background, so
   *   the screen never blanks while catching up.
   * - expired: awaits a real fetch.
   *
   * Concurrent callers for one key share a single in-flight request, so a
   * screen mounting three components that need the same data issues one
   * network call rather than three.
   */
  async read<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheSetOptions = {
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      expiresAfterMs: DEFAULT_EXPIRES_AFTER_MS
    }
  ): Promise<T> {
    const now = options.now ?? Date.now();
    const state = this.stateOf(key, now);

    if (state === "fresh") {
      this.counters.hits += 1;
      this.touch(key);
      return this.entries.get(key)!.data as T;
    }

    if (state === "stale") {
      const cached = this.entries.get(key)!.data as T;
      this.counters.hits += 1;
      this.counters.staleReads += 1;
      this.counters.revalidations += 1;
      this.touch(key);
      // Revalidate without awaiting, and without letting a failure surface as
      // an unhandled rejection — a failed refresh simply leaves the stale
      // value in place until it expires.
      void this.dedupe(key, fetcher, options).catch(() => {});
      return cached;
    }

    this.counters.misses += 1;
    return this.dedupe(key, fetcher, options);
  }

  /**
   * Run a fetch, sharing one in-flight promise per key.
   *
   * The version is captured BEFORE the request and checked after: a response
   * that arrives following a logout or a block belongs to an authorisation
   * that no longer applies, so it is returned to its caller but never cached.
   */
  private async dedupe<T>(key: string, fetcher: () => Promise<T>, options: CacheSetOptions): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      // A request this caller did not have to make.
      this.counters.dedupedRequests += 1;
      return existing as Promise<T>;
    }

    const versionAtRequest = this.authorizationVersion;
    const request = (async () => {
      try {
        const data = await fetcher();
        if (versionAtRequest === this.authorizationVersion) {
          this.set(key, data, options);
        }
        return data;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, request);
    return request;
  }

  /** Whether a request for this key is already running. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** Drop one entry — a profile that changed, a Moment that was deleted. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Drop every entry whose key starts with a prefix.
   *
   * Used for a whole family at once: every Moment by a blocked author, every
   * cached view of one profile.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /**
   * Invalidate EVERYTHING by moving the authorisation scope forward.
   *
   * Used for logout, account switch, block and privacy changes. Bumping the
   * version rather than only clearing the map also strands any request that
   * is already in flight, so a response authorised under the old scope cannot
   * be written back afterwards.
   */
  invalidateAll(): void {
    this.authorizationVersion += 1;
    this.entries.clear();
    this.inFlight.clear();
  }

  /** Entries currently held, for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * The app-wide instance.
 *
 * One cache, so a Moment fetched for Home and the same Moment on the Moments
 * page share an entry rather than being fetched twice.
 */
export const appCache = new EntityCache();

/** Namespaced keys, so one family can be invalidated together. */
export const cacheKeys = {
  home: (userId: string) => `home:${userId}`,
  /**
   * Home's Near rail — the one Home section that loads on the client.
   *
   * Not keyed by user: the cache is already scoped to the signed-in session
   * (an account switch bumps authorizationVersion and clears everything), so
   * a per-user key would add a parameter without adding safety.
   */
  homeNearby: () => "home:nearby",
  moment: (momentId: string) => `moment:${momentId}`,
  momentsFeed: (userId: string) => `moments:feed:${userId}`,
  profile: (username: string) => `profile:${username}`,
  conversations: (userId: string) => `messages:list:${userId}`
} as const;

/** Every cached view of one profile and the Moments attributed to them. */
export function invalidateProfile(username: string, cache: EntityCache = appCache): void {
  cache.invalidate(cacheKeys.profile(username));
}

/**
 * A blocked or unblocked relationship changes what the viewer may see
 * everywhere at once, so the safe response is to drop everything rather than
 * guess which entries were affected.
 */
export function invalidateForAuthorizationChange(cache: EntityCache = appCache): void {
  cache.invalidateAll();
}
