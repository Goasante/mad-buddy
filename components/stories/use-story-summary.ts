"use client";

import { useCallback, useEffect, useState } from "react";
import { getStorySummaryAction } from "@/app/(app)/stories-actions";
import { appCache, cacheKeys } from "@/lib/cache/entity-cache";
import type { StorySummary } from "@/lib/stories/types";

const STORY_SUMMARY_STALE_MS = 30 * 1000;
const STORY_SUMMARY_CACHE_MS = 60 * 1000;

export function invalidateStorySummary(authorId: string) {
  appCache.invalidate(cacheKeys.storySummary(authorId));
}

export function useStorySummary(
  authorId: string | null | undefined,
  initialSummary: StorySummary | null | undefined = undefined
) {
  const [summary, setSummary] = useState<StorySummary | null>(initialSummary ?? null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!authorId) {
        setSummary(null);
        return null;
      }
      const key = cacheKeys.storySummary(authorId);
      if (force) appCache.invalidate(key);
      setLoading(true);
      try {
        const next = await appCache.read(
          key,
          () => getStorySummaryAction(authorId),
          {
            staleAfterMs: STORY_SUMMARY_STALE_MS,
            expiresAfterMs: STORY_SUMMARY_CACHE_MS
          }
        );
        setSummary(next);
        return next;
      } finally {
        setLoading(false);
      }
    },
    [authorId]
  );

  // Server-rendered Profile/Muddy pages already paid for this lookup. Seed the
  // short in-memory cache (including an authoritative null) before the normal
  // read-through effect, so hydration does not immediately repeat it.
  useEffect(() => {
    if (!authorId || initialSummary === undefined) return;
    appCache.set(cacheKeys.storySummary(authorId), initialSummary, {
      staleAfterMs: STORY_SUMMARY_STALE_MS,
      expiresAfterMs: STORY_SUMMARY_CACHE_MS
    });
  }, [authorId, initialSummary]);

  useEffect(() => {
    if (!authorId) {
      setSummary(null);
      return;
    }
    void load(false);
  }, [authorId, load]);

  // No timer polling. When the person returns to the app, re-authorize and
  // refresh once so newly posted/deleted Stories appear promptly.
  useEffect(() => {
    if (!authorId) return;
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [authorId, load]);

  // A ring must disappear at the real expiry boundary, not up to a minute
  // later just because its metadata was cached.
  useEffect(() => {
    if (!authorId || !summary?.nextExpiryAt) return;
    const delay = Math.max(0, Date.parse(summary.nextExpiryAt) - Date.now()) + 30;
    const timer = window.setTimeout(() => {
      void load(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [authorId, summary?.nextExpiryAt, load]);

  return {
    summary,
    loading,
    refresh: () => load(true)
  };
}
