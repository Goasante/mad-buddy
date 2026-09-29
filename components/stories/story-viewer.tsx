"use client";

import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteStoryAction,
  getStoriesForAuthorAction,
  recordStoryViewAction
} from "@/app/(app)/stories-actions";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MomentImage } from "@/components/ui/moment-image";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { invalidateStorySummary } from "@/components/stories/use-story-summary";
import type { StoryItem } from "@/lib/stories/types";
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
  const [isDeleting, startDelete] = useTransition();
  const dragStartY = useRef<number | null>(null);
  const recordedViewIdsRef = useRef(new Set<string>());
  const active = items[activeIndex] ?? null;

  const close = useCallback(() => {
    setItems([]);
    setActiveIndex(0);
    setProgress(0);
    setError("");
    setLoading(true);
    onClose();
  }, [onClose]);

  useDismissOnBack(open, close);

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
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const step = useCallback(
    (delta: number) => {
      setProgress(0);
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
    [items.length, close]
  );

  useEffect(() => {
    if (!open || !active || active.isAuthor || active.viewed) return;
    if (recordedViewIdsRef.current.has(active.id)) return;

    recordedViewIdsRef.current.add(active.id);
    if (authorId) invalidateStorySummary(authorId);
    void recordStoryViewAction(active.id).then(() => onChanged?.());
  }, [open, active, authorId, onChanged]);

  useEffect(() => {
    if (!open || !active) return;
    const remaining = Math.max(0, Date.parse(active.expiresAt) - Date.now());

    if (remaining <= 0) {
      const expiredTimer = window.setTimeout(() => {
        if (items.length <= 1) {
          if (authorId) invalidateStorySummary(authorId);
          onChanged?.();
          close();
          return;
        }
        setItems((current) => current.filter((story) => story.id !== active.id));
        setActiveIndex((current) => Math.min(current, items.length - 2));
        setProgress(0);
        if (authorId) invalidateStorySummary(authorId);
        onChanged?.();
      }, 0);
      return () => window.clearTimeout(expiredTimer);
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
  }, [open, active, items.length, authorId, onChanged, step, close]);

  const progressValues = useMemo(
    () =>
      items.map((_, index) => {
        if (index < activeIndex) return 1;
        if (index > activeIndex) return 0;
        return progress;
      }),
    [items, activeIndex, progress]
  );

  if (!open) return null;

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story viewer"
      className="fixed inset-0 z-[100] flex bg-black text-white"
      onPointerDown={(event) => {
        dragStartY.current = event.clientY;
      }}
      onPointerUp={(event) => {
        const start = dragStartY.current;
        dragStartY.current = null;
        if (start !== null && event.clientY - start > 110) close();
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
            src={active.mediaUrl}
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
          {items.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous Story"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                className="absolute bottom-20 left-0 top-20 z-20 w-1/3 bg-transparent"
              />
              <button
                type="button"
                aria-label="Next Story"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                className="absolute bottom-20 right-0 top-20 z-20 w-1/3 bg-transparent"
              />
            </>
          ) : null}
          {active.caption ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-20">
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
    </div>
  );
}
