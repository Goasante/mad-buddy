"use client";

import { Eye, Heart, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  deleteStoryAction,
  getStoriesForAuthorAction,
  recordStoryViewAction,
  setStoryLikeAction,
  getStoryEngagementAction
} from "@/app/(app)/stories-actions";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MomentImage } from "@/components/ui/moment-image";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { invalidateStorySummary } from "@/components/stories/use-story-summary";
import type { StoryItem, StoryEngagement } from "@/lib/stories/types";
import { formatRelativeTime } from "@/lib/utils";

const STORY_DISPLAY_MS = 5000;

export function StoryViewer({
  authorId,
  open,
  onClose,
  onChanged
}: {
  authorId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<StoryItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loadedStoryId, setLoadedStoryId] = useState<string | null>(null);
  const [playbackRevision, setPlaybackRevision] = useState(0);
  const [isLiking, startLike] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const dragStartY = useRef<number | null>(null);
  const recordedViewIdsRef = useRef(new Set<string>());
  const active = items[activeIndex] ?? null;
  const activeId = active?.id;
  const activeExpiresAt = active?.expiresAt;

  const close = useCallback(() => {
    setItems([]);
    setActiveIndex(0);
    setProgress(0);
    setError("");
    setLoading(true);
    setDetailsOpen(false);
    setLoadedStoryId(null);
    onClose();
  }, [onClose]);

  useDismissOnBack(open, () => { if (detailsOpen) setDetailsOpen(false); else close(); });

  useEffect(() => {
    if (!open || !authorId) return;
    let cancelled = false;
    void getStoriesForAuthorAction(authorId)
      .then((stories) => {
        if (cancelled) return;
        const live = stories.filter((story) => Date.parse(story.expiresAt) > Date.now());
        setItems(live);
        setProgress(0);
        setError(live.length === 0 ? "This Story is no longer available." : "");
        const firstUnseen = live.findIndex((story) => !story.isAuthor && !story.viewed);
        setActiveIndex(firstUnseen >= 0 ? firstUnseen : 0);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this Story.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, authorId]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousHtmlBackground = document.documentElement.style.backgroundColor;
    document.body.style.overflow = "hidden";
    document.body.style.backgroundColor = "#000";
    document.documentElement.style.backgroundColor = "#000";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.backgroundColor = previousBodyBackground;
      document.documentElement.style.backgroundColor = previousHtmlBackground;
    };
  }, [open]);

  const step = useCallback(
    (delta: number) => {
      setProgress(0);
      // Restarting the first Story keeps the same image mounted, so it will
      // not emit another load event. Preserve its loaded state and explicitly
      // restart playback; navigating to another Story waits for its image.
      if (delta >= 0 || activeIndex > 0) setLoadedStoryId(null);
      setPlaybackRevision((current) => current + 1);
      setDetailsOpen(false);
      if (delta < 0) {
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }
      setActiveIndex((current) => {
        if (current >= items.length - 1) {
          window.setTimeout(close, 0);
          return current;
        }
        return current + 1;
      });
    },
    [items.length, activeIndex, close]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (detailsOpen) {
        if (event.key === "Escape") { event.preventDefault(); setDetailsOpen(false); }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, step, close, detailsOpen]);

  useEffect(() => {
    if (!open || !active || active.isAuthor || active.viewed || loadedStoryId !== active.id) return;
    if (recordedViewIdsRef.current.has(active.id)) return;

    recordedViewIdsRef.current.add(active.id);
    if (authorId) invalidateStorySummary(authorId);
    void recordStoryViewAction(active.id).then((ok) => {
      if (ok) {
        setItems((current) => current.map((story) => story.id === active.id ? { ...story, viewed: true } : story));
        onChanged?.();
      } else recordedViewIdsRef.current.delete(active.id);
    }).catch(() => recordedViewIdsRef.current.delete(active.id));
  }, [open, active, authorId, onChanged, loadedStoryId]);

  useEffect(() => {
    if (!open || !activeId || !activeExpiresAt) return;
    const remaining = Math.max(0, Date.parse(activeExpiresAt) - Date.now());

    if (remaining <= 0) {
      const expiredTimer = window.setTimeout(() => {
        if (items.length <= 1) {
          if (authorId) invalidateStorySummary(authorId);
          onChanged?.();
          close();
          return;
        }
        setItems((current) => current.filter((story) => story.id !== activeId));
        setActiveIndex((current) => Math.min(current, items.length - 2));
        setProgress(0);
        if (authorId) invalidateStorySummary(authorId);
        onChanged?.();
      }, 0);
      return () => window.clearTimeout(expiredTimer);
    }

    // Expiry is still enforced while the creator inspects viewers. Ordinary
    // playback starts only once the photo has actually loaded.
    if (detailsOpen || loadedStoryId !== activeId) {
      const expiryTimer = window.setTimeout(() => step(1), remaining);
      return () => window.clearTimeout(expiryTimer);
    }
    const duration = Math.min(STORY_DISPLAY_MS, remaining);
    const started = Date.now();
    const interval = window.setInterval(() => {
      setProgress(Math.min(1, (Date.now() - started) / duration));
    }, 100);
    const timeout = window.setTimeout(() => step(1), duration);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [open, activeId, activeExpiresAt, items.length, authorId, onChanged, step, close, detailsOpen, loadedStoryId, playbackRevision]);

  const progressValues = useMemo(
    () =>
      items.map((_, index) => {
        if (index < activeIndex) return 1;
        if (index > activeIndex) return 0;
        return progress;
      }),
    [items, activeIndex, progress]
  );

  if (!open || typeof document === "undefined") return null;

  function likeActive() {
    if (!active || active.isAuthor || isLiking) return;
    const storyId = active.id;
    const previous = active.liked;
    setError("");
    setItems((current) => current.map((story) => story.id === storyId ? { ...story, liked: !previous } : story));
    startLike(async () => {
      try {
        const result = await setStoryLikeAction(storyId, !previous);
        if (result.ok) return;
        setError(result.message);
      } catch {
        setError("Couldn't update your like. Try again.");
      }
      setItems((current) => current.map((story) => story.id === storyId ? { ...story, liked: previous } : story));
    });
  }

  function removeActive() {
    if (!active?.isAuthor || isDeleting) return;
    if (!window.confirm("Delete this Story now?")) return;
    startDelete(async () => {
      const result = await deleteStoryAction(active.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (authorId) invalidateStorySummary(authorId);
      const remaining = items.filter((story) => story.id !== active.id);
      setItems(remaining);
      setActiveIndex((current) => Math.min(current, Math.max(0, remaining.length - 1)));
      setProgress(0);
      onChanged?.();
      if (remaining.length === 0) close();
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story viewer"
      className="pointer-events-auto fixed inset-0 z-[100] flex h-[100dvh] w-screen touch-manipulation overscroll-none bg-black text-white"
      onPointerDown={(event) => {
        dragStartY.current = event.clientY;
      }}
      onPointerUp={(event) => {
        const start = dragStartY.current;
        dragStartY.current = null;
        if (!detailsOpen && start !== null && event.clientY - start > 110) close();
      }}
    >
      {items.length > 0 ? (
        <div className="absolute inset-x-3 top-[max(0.65rem,env(safe-area-inset-top))] z-30 flex gap-1.5">
          {progressValues.map((value, index) => (
            <span key={items[index]?.id ?? index} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <span
                className="block h-full rounded-full bg-white"
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </span>
          ))}
        </div>
      ) : null}

      <div className="absolute inset-x-3 top-[calc(max(0.65rem,env(safe-area-inset-top))+1rem)] z-30 flex min-h-11 items-center gap-2">
        {active ? (
          <>
            <UserAvatar src={active.authorAvatarUrl} name={active.authorName} size="sm" decorative />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{active.authorName}</p>
              <p className="text-xs text-white/70">{formatRelativeTime(active.createdAt)}</p>
            </div>
          </>
        ) : (
          <span className="flex-1" />
        )}
        {active?.isAuthor ? (
          <button
            type="button"
            onClick={removeActive}
            disabled={isDeleting}
            className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white"
            aria-label="Delete Story"
            title="Delete Story"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={close}
          className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white"
          aria-label="Close Stories"
          title="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {active ? (
        <>
          <MomentImage
            key={active.id}
            src={active.mediaUrl}
            onLoad={() => setLoadedStoryId(active.id)}
            alt={active.caption?.trim() || `Story from ${active.authorName}`}
            unavailableLabel="Story unavailable"
            className="h-full max-h-none min-h-0 w-full select-none object-contain"
            fallbackClassName="h-full w-full bg-black text-white"
            priority
            onRetry={() => {
              if (!authorId) return;
              void getStoriesForAuthorAction(authorId).then((fresh) => {
                const replacement = fresh.find((story) => story.id === active.id);
                if (!replacement) return;
                setItems((current) =>
                  current.map((story) =>
                    story.id === active.id
                      ? { ...story, mediaUrl: replacement.mediaUrl }
                      : story
                  )
                );
              });
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-20 z-20 grid grid-cols-2">
            <button
              type="button"
              aria-label={activeIndex > 0 ? "Previous Story" : "Restart Story"}
              onClick={(event) => {
                event.stopPropagation();
                step(-1);
              }}
              className="pointer-events-auto h-full w-full bg-transparent touch-manipulation"
            />
            <button
              type="button"
              aria-label={activeIndex < items.length - 1 ? "Next Story" : "Close Stories"}
              onClick={(event) => {
                event.stopPropagation();
                step(1);
              }}
              className="pointer-events-auto h-full w-full bg-transparent touch-manipulation"
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 z-30 flex min-h-16 items-center justify-center bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
            {active.isAuthor ? (
              <StoryOwnerEngagement key={active.id} storyId={active.id} open={detailsOpen} onOpenChange={setDetailsOpen} />
            ) : (
              <button type="button" onClick={likeActive} disabled={isLiking || loadedStoryId !== active.id} aria-label={active.liked ? "Unlike Story" : "Like Story"} aria-pressed={active.liked} className="focus-ring ml-auto flex min-h-11 items-center gap-2 rounded-full bg-black/50 px-4 text-sm font-semibold disabled:opacity-60">
                <Heart className={active.liked ? "h-6 w-6 fill-rose-500 text-rose-500" : "h-6 w-6"} aria-hidden="true" />{active.liked ? "Liked" : "Like"}
              </button>
            )}
          </div>
          {active.caption ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-20">
              <p className="mx-auto max-w-xl text-sm leading-6 text-white/95">{active.caption}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="m-auto px-6 text-center">
          <p className="text-sm font-medium">{loading ? "Loading Stories…" : error || "No active Stories."}</p>
        </div>
      )}

      {error && active ? (
        <p role="status" className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/65 px-4 py-2 text-xs">
          {error}
        </p>
      ) : null}
    </div>,
    document.body
  );
}

function StoryOwnerEngagement({ storyId, open, onOpenChange }: { storyId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<StoryEngagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getStoryEngagementAction(storyId).then((result) => {
      if (cancelled) return;
      setData(result);
      setError(result ? "" : "Couldn't load views and likes.");
    }).catch(() => { if (!cancelled) setError("Couldn't load views and likes."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storyId, refreshKey]);

  useEffect(() => () => onOpenChange(false), [onOpenChange]);

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (next) { setLoading(true); setRefreshKey((value) => value + 1); }
  }

  async function more() {
    if (!data || data.nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getStoryEngagementAction(storyId, data.nextOffset);
      if (!result) { setError("Couldn't load more viewers. Try again."); return; }
      setData((current) => current ? { ...result, viewers: [...new Map([...current.viewers, ...result.viewers].map((viewer) => [viewer.id, viewer])).values()] } : result);
      setError("");
    } catch { setError("Couldn't load more viewers. Try again."); }
    finally { setLoadingMore(false); }
  }

  return (
    <>
      <button type="button" onClick={() => changeOpen(true)} aria-label="View Story views and likes" className="focus-ring flex min-h-11 items-center gap-4 rounded-full bg-black/50 px-4 text-sm font-semibold">
        {loading && !data ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading views" /> : data ? <><span className="flex items-center gap-2"><Eye className="h-5 w-5" aria-hidden="true" />{data.viewCount} views</span><span className="flex items-center gap-2"><Heart className="h-5 w-5 text-rose-400" aria-hidden="true" />{data.likeCount} likes</span></> : "Views and likes"}
      </button>
      {open ? (
        <section role="dialog" aria-label="Story viewers" className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[65dvh] max-w-xl overflow-y-auto rounded-t-3xl border border-white/15 bg-[#171717] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white shadow-xl" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); changeOpen(false); } }}>
          <header className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Viewed by {data?.viewCount ?? "…"}</h2><p className="text-sm text-white/65">{data?.likeCount ?? 0} likes · Only you can see this list</p></div><button type="button" onClick={() => changeOpen(false)} aria-label="Close viewers" className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-white/10"><X className="h-5 w-5" /></button></header>
          {loading ? <p role="status" className="py-4 text-sm text-white/70">Loading viewers…</p> : null}
          {error ? <div role="status" className="py-3 text-sm"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }} className="focus-ring mt-2 min-h-11 underline">Try again</button></div> : null}
          {!loading && !error && data?.viewers.length === 0 ? <p className="py-5 text-sm text-white/70">No views yet.</p> : null}
          <ul className="space-y-3">{data?.viewers.map((viewer) => <li key={viewer.id} className="flex items-center gap-3"><UserAvatar src={viewer.avatarUrl} name={viewer.name} size="sm" decorative /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{viewer.name}</p><p className="text-xs text-white/60">{formatRelativeTime(viewer.viewedAt)}</p></div>{viewer.liked ? <Heart className="h-5 w-5 fill-rose-500 text-rose-500" aria-label="Liked your Story" /> : null}</li>)}</ul>
          {data?.nextOffset !== null && data ? <button type="button" disabled={loadingMore} onClick={() => { void more(); }} className="focus-ring mt-4 min-h-11 w-full rounded-xl bg-white/10 px-3 text-sm disabled:opacity-60">{loadingMore ? "Loading…" : "More viewers"}</button> : null}
        </section>
      ) : null}
    </>
  );
}
