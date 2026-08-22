"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { UPFOR_MODES, upForEmptyCopy, type UpForMode } from "@/lib/social/upfor-feed";

/**
 * The pieces around the UpFor feed: tabs, empty states, skeletons, errors.
 *
 * Split out so the page stays a composition rather than becoming the next
 * 1,200-line component. Every string a person reads about "nothing here" comes
 * from upForEmptyCopy, which is tested -- so a tab cannot quietly start
 * claiming something the system does not know.
 */

/** The four approved discovery modes, as a real tab row. */
export function UpForTabs({
  active,
  onChange,
  counts
}: {
  active: UpForMode;
  onChange: (mode: UpForMode) => void;
  /** Live counts per mode, so a tab can show it has something. */
  counts?: Partial<Record<UpForMode, number>>;
}) {
  return (
    <div className="upfor-tabs" role="tablist" aria-label="UpFor discovery">
      {UPFOR_MODES.map((mode) => {
        const isActive = mode.id === active;
        const count = counts?.[mode.id];
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            id={`upfor-tab-${mode.id}`}
            aria-selected={isActive}
            aria-controls={`upfor-panel-${mode.id}`}
            className={cn("upfor-tab", isActive && "is-active")}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
            {/* A count only when there is something to count: a "0" beside
                every tab reads as failure rather than as information. */}
            {typeof count === "number" && count > 0 ? (
              <span className="upfor-tab__count">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Nothing to show, said truthfully.
 *
 * The copy is per-mode and comes from the tested helper. "Around" is the one
 * that matters: the app knows no eligible live UpFor came back, which is not
 * the same as knowing nobody is nearby.
 */
export function UpForEmptyState({
  mode,
  onStart
}: {
  mode: UpForMode;
  onStart?: () => void;
}) {
  const copy = upForEmptyCopy(mode);
  return (
    <div className="upfor-empty" role="status">
      <p className="upfor-empty__title">{copy.title}</p>
      <p className="upfor-empty__body">{copy.body}</p>
      {onStart ? (
        <button type="button" className="upfor-empty__cta" onClick={onStart}>
          Start an UpFor
        </button>
      ) : null}
    </div>
  );
}

/**
 * Loading, shaped like the cards it replaces.
 *
 * Same block heights as a real card, so switching tabs does not resize the
 * list under the reader's thumb. A centred spinner over an empty page would
 * be less work and would tell them nothing about what is arriving.
 */
export function UpForSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="upfor-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="upfor-skeleton__card">
          <div className="upfor-skeleton__head">
            <span className="upfor-skeleton__avatar" />
            <span className="upfor-skeleton__lines">
              <span className="upfor-skeleton__line upfor-skeleton__line--short" />
              <span className="upfor-skeleton__line" />
            </span>
          </div>
          <span className="upfor-skeleton__line upfor-skeleton__line--wide" />
          <div className="upfor-skeleton__foot">
            <span className="upfor-skeleton__pill" />
            <span className="upfor-skeleton__pill upfor-skeleton__pill--wide" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A recoverable failure, kept in place.
 *
 * Ordinary feed and action failures stay on the screen the person is already
 * on. Routing them to a full-page error would lose the tab they chose and the
 * scroll position they earned, for a problem that a retry usually fixes.
 */
export function UpForError({
  message,
  onRetry,
  retrying = false
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="upfor-error" role="alert">
      <p className="upfor-error__message">{message}</p>
      {onRetry ? (
        <button type="button" className="upfor-error__retry" onClick={onRetry} disabled={retrying}>
          {retrying ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          Try again
        </button>
      ) : null}
    </div>
  );
}
