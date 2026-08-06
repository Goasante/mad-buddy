/**
 * Canonical image-request map.
 *
 * Avatars and thumbnails appear on Home, Messages, Socialize, Profiles and
 * Moments at once. Without a shared map the same avatar is requested once per
 * surface; with it, the first request wins and the rest reuse its promise.
 *
 * IMPORTANT: this stores URLs and in-flight promises — never image BYTES.
 * Decoded images live in the browser's own HTTP cache under normal rules,
 * which is what the brief allows. Nothing here persists private media, and
 * nothing survives a reload.
 *
 * Signed URLs are the reason this needs care. Moment and Drop media is served
 * from a private bucket via short-lived signed URLs, so a cached URL is only
 * usable until it expires — after which it is discarded rather than retried,
 * because a URL that no longer works is not evidence of access.
 */

/**
 * Identity of an image, independent of the URL that currently serves it.
 *
 * A signed URL changes every time it is minted, so keying on the URL would
 * defeat deduplication entirely. Callers key on the stable media id (or the
 * avatar path) and the map holds whichever URL is currently valid.
 */
export type ImageIdentity = string;

type ImageRecord = {
  url: string;
  /** When the URL stops being usable. Signed URLs expire; public ones do not. */
  expiresAt: number;
};

/** Signed media URLs last five minutes server-side (SIGNED_URL_TTL_SECONDS). */
export const SIGNED_URL_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Discard a signed URL slightly BEFORE the server would reject it, so an
 * image that starts loading at the boundary does not fail mid-flight.
 */
const EXPIRY_SAFETY_MARGIN_MS = 15 * 1000;

export class ImageRequestMap {
  private urls = new Map<ImageIdentity, ImageRecord>();
  private inFlight = new Map<ImageIdentity, Promise<string | null>>();

  /**
   * The currently valid URL for this image, or null when there is none.
   *
   * An expired URL is deleted rather than returned: continuing to serve it
   * would present stale authorisation as current access.
   */
  get(identity: ImageIdentity, now = Date.now()): string | null {
    const record = this.urls.get(identity);
    if (!record) return null;
    if (now >= record.expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
      this.urls.delete(identity);
      return null;
    }
    return record.url;
  }

  /**
   * Remember a URL for an image.
   *
   * `lifetimeMs` defaults to the signed-URL lifetime. Pass Infinity for a
   * public asset that does not expire.
   */
  set(identity: ImageIdentity, url: string, lifetimeMs = SIGNED_URL_LIFETIME_MS, now = Date.now()): void {
    this.urls.set(identity, { url, expiresAt: now + lifetimeMs });
  }

  /**
   * Resolve an image URL, requesting it at most once per identity.
   *
   * Concurrent callers share one request, so the same avatar rendered in six
   * places downloads once. A resolver returning null (no longer authorised,
   * media removed) is cached as "nothing" only in the sense that the caller
   * gets null — no URL is stored.
   */
  async resolve(
    identity: ImageIdentity,
    resolver: () => Promise<string | null>,
    lifetimeMs = SIGNED_URL_LIFETIME_MS,
    now = Date.now()
  ): Promise<string | null> {
    const cached = this.get(identity, now);
    if (cached) return cached;

    const existing = this.inFlight.get(identity);
    if (existing) return existing;

    const request = (async () => {
      try {
        const url = await resolver();
        if (url) this.set(identity, url, lifetimeMs, now);
        return url;
      } finally {
        this.inFlight.delete(identity);
      }
    })();

    this.inFlight.set(identity, request);
    return request;
  }

  /** Whether a request for this image is already running. */
  isInFlight(identity: ImageIdentity): boolean {
    return this.inFlight.has(identity);
  }

  /** Forget one image — its media was deleted, or access was revoked. */
  invalidate(identity: ImageIdentity): void {
    this.urls.delete(identity);
  }

  /** Forget everything. Logout, account switch, or any authorisation change. */
  clear(): void {
    this.urls.clear();
    this.inFlight.clear();
  }

  /** URLs currently held, for tests and diagnostics. */
  get size(): number {
    return this.urls.size;
  }
}

export const imageRequests = new ImageRequestMap();
