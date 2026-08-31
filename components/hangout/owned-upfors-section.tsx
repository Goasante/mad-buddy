"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canOfferAnotherUpFor,
  ownedUpForCapacityLabel,
  ownedUpForViews,
  type OwnedUpFor
} from "@/lib/social/owned-upfors";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/**
 * The owner's own UpFors -- every one they hold, live and scheduled.
 *
 * A COMPACT LIST, NOT A DASHBOARD. A person may hold three at once, and three
 * hero cards would fill a phone before the discovery feed existed. Each row
 * answers only what the owner needs at a glance: what it is, when it is, who
 * can see it, and whether anyone is waiting.
 *
 * Presentation is decided by lib/social/owned-upfors.ts -- order, live versus
 * scheduled, the time sentence, the capacity line. This file renders that
 * projection and nothing more, so the rules stay testable without a browser and
 * cannot drift into JSX.
 *
 * Lives in its own file deliberately. Rebuilding this inside the already-large
 * hangout-mode-page meant editing a deeply nested render tree, which is how the
 * previous attempt broke the JSX structure.
 */
export function OwnedUpForsSection({
  ownedUpFors,
  nowMs,
  pendingRequestCounts = {},
  busy = false,
  onCreate,
  onManage
}: {
  ownedUpFors: readonly OwnedUpFor[];
  /** The page's single clock. No row keeps a timer of its own. */
  nowMs: number;
  /** Pending requests per UpFor id, so a row can say who is waiting. */
  pendingRequestCounts?: Record<string, number>;
  busy?: boolean;
  onCreate: () => void;
  onManage: (upForId: string) => void;
}) {
  const views = ownedUpForViews(ownedUpFors, nowMs);

  // Nothing to manage: the page's own creation experience is the focus, and an
  // empty management panel would only say "you have 0 records".
  if (views.length === 0) return null;

  return (
    <section
      aria-labelledby="owned-upfors-heading"
      /* The tour's anchor for "your UpFors". It used to sit on the legacy owner
         hero; that hero is gone, and this list is what replaced it, so the tour
         step points here rather than at nothing. */
      data-tour-id={TOUR_TARGET_IDS.HANGOUT_ACTIVE}
      className="upfor-section"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="owned-upfors-heading" className="text-[16px] font-semibold">
          Your UpFors
        </h2>
        <span className="text-[12px] text-muted-foreground">
          {ownedUpForCapacityLabel(ownedUpFors, nowMs)}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {views.map((view) => {
          const label =
            HANGOUT_ACTIVITY_LABELS[view.activityType as HangoutActivityType] ?? "Anything";
          const pending = pendingRequestCounts[view.id] ?? 0;

          return (
            <li
              key={view.id}
              className="flex items-center gap-3 rounded-[12px] border border-border/60 bg-card/60 p-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{label}</span>
                {/* State in words. "Live now" is never carried by colour alone. */}
                <span
                  className="mt-0.5 block truncate text-[12px] text-muted-foreground"
                  suppressHydrationWarning
                >
                  {view.timeLabel}
                </span>
                {view.message ? (
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    &ldquo;{view.message}&rdquo;
                  </span>
                ) : null}
                {pending > 0 ? (
                  <span className="mt-0.5 block text-[12px] font-semibold text-primary">
                    {pending} {pending === 1 ? "request" : "requests"}
                  </span>
                ) : null}
              </span>

              {/* One restrained affordance per row rather than a row of
                  buttons. Everything else lives behind it. */}
              <button
                type="button"
                onClick={() => onManage(view.id)}
                disabled={busy}
                className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition hover:bg-secondary disabled:opacity-55"
                aria-label={
                  pending > 0
                    ? `Manage ${label} UpFor, ${pending} ${pending === 1 ? "request" : "requests"}`
                    : `Manage ${label} UpFor`
                }
              >
                <span aria-hidden="true" className="text-[18px] leading-none">
                  •••
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Offered only while there is room. The database still decides whether a
          fourth may exist -- this only decides whether to invite one. */}
      {canOfferAnotherUpFor(ownedUpFors, nowMs) ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={onCreate}
          disabled={busy}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add another UpFor
        </Button>
      ) : null}
    </section>
  );
}
