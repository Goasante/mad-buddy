"use client";

import { Flag, MoreHorizontal, Plus, Trash2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  deleteMomentAction,
  getMomentFeedAction,
  getMomentsCreatorHubAction,
  getCreatorSpotlightMomentsAction,
  getMyTuneInsAction,
  getMomentFullMediaUrlAction,
  getOpenMomentFeedAction,
  reactToMomentAction,
  recordMomentViewAction,
  recordSpotlightViewedAction,
  removeMomentReactionAction,
  reportContentAction,
  tuneInAction,
  tuneOutAction
} from "@/app/(app)/moments-actions";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { REPORT_CATEGORIES } from "@/lib/content/safety";
import type { MomentsCreatorHub, TuneInEntry, VisibleMoment } from "@/lib/content/service";
import type { MomentReactionId } from "@/lib/content/moments";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import {
  buildMomentSections,
  isMomentsTrulyEmpty,
  momentsTabItems,
  resolveMomentTab,
  MOMENT_TABS,
  type MomentSections,
  type MomentTab
} from "@/lib/content/moments-tabs";
import { MomentTile } from "@/components/content/moment-tile";
import { MomentMediaViewer } from "@/components/content/moment-media-viewer";
import {
  MOMENT_PARAM,
  momentAnchorId,
  resolveMomentTarget,
  rotateSequenceToTarget,
  urlWithoutMomentParam,
  type MomentTargetResolution
} from "@/lib/content/moment-target";
import {
  AuthorInsights,
  MomentHeader,
  MomentMedia,
  MomentsRing,
  OnAirBadge,
  ReactionControl,
  TuneInButton,
  TunedInCount,
  useMomentClock
} from "@/components/content/moment-parts";
import { MomentComposer, type MomentMuddyOption } from "@/components/content/moment-composer";
import { TuneInIcon } from "@/components/content/tune-in-icon";
import {
  TunedInManageModal,
  TunedInStrip,
  TunedInViewer,
  useTunedInLane
} from "@/components/content/tuned-in-strip";
import { usePullRefreshListener } from "@/components/ui/pull-to-refresh";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";

/** Retained for the route's existing prop contract. */
export type MomentAudienceOption = { id: string; name: string };

/**
 * Moments: two experiences on one surface.
 *
 * MOMENTS   private, temporary images shared with chosen Muddies.
 * SPOTLIGHT public, temporary images discoverable across Mad Buddy.
 *
 * There are deliberately no comments in this phase: no count, no button, no
 * drawer and no action to call. Engagement is positive reactions plus views, and
 * there is no negative reaction anywhere in the model. Disapproval routes to
 * report/block, which are the existing systems.
 *
 * There is no follower graph either. Spotlight interest is Tune In: one-way,
 * private, silent, and independent of reactions.
 */
export function MomentsPage({
  initialMoments = [],
  initialOpenMoments = [],
  muddies = [],
  openMomentsEnabled = false,
  viewerName = "You",
  viewerAvatarUrl = null,
  closeFriendsAvailable = false,
  birthdayTemplateAvailable = false
}: {
  initialMoments?: VisibleMoment[];
  initialOpenMoments?: VisibleMoment[];
  muddies?: MomentMuddyOption[];
  openMomentsEnabled?: boolean;
  viewerName?: string;
  viewerAvatarUrl?: string | null;
  closeFriendsAvailable?: boolean;
  birthdayTemplateAvailable?: boolean;
}) {
  const router = useRouter();
  const nowMs = useMomentClock();
  const [moments, setMoments] = useState(initialMoments);
  const [spotlight, setSpotlight] = useState(initialOpenMoments);
  // The URL IS the tab state, derived not mirrored: /moments?tab=air is
  // linkable, survives a reload, and Back works without a sync effect.
  // `spotlight` is the legacy spelling and maps to Air.
  const searchParams = useSearchParams();
  const tab = resolveMomentTab(searchParams.get("tab"));
  const [composerOpen, setComposerOpen] = useState(false);
  const [reportFor, setReportFor] = useState<VisibleMoment | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [hub, setHub] = useState<MomentsCreatorHub | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [myTuneIns, setMyTuneIns] = useState<TuneInEntry[]>([]);
  const [feedback, setFeedback] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // State, not a ref: the avatar ring reads this during render to show the
  // "something new" ring, so it has to participate in rendering.
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(() => new Set());
  // Full-screen media: which Moment is open, and where its video had got to so
  // it can resume instead of restarting.
  const [fullScreenFor, setFullScreenFor] = useState<VisibleMoment | null>(null);
  // The larger asset, fetched only when full-screen actually opens. Cards keep
  // shipping the 1080px feed variant, so opening one Moment never costs the
  // whole page a full-resolution download.
  const [fullResUrl, setFullResUrl] = useState<string | null>(null);
  const videoPositions = useRef<Map<string, number>>(new Map());
  // Lets the viewer dismiss the unavailable notice. The MESSAGE itself is
  // derived below, never stored.
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Which feed each tab reads. All renders its own sections below.
  const feed = tab === "air" ? spotlight : momentsTabItems(moments, spotlight);
  const sections = buildMomentSections(moments, spotlight, { nowMs });
  const trulyEmpty = isMomentsTrulyEmpty(moments, spotlight);

  // This page holds its feeds in client state, so a server re-render alone will
  // not update them. The shell owns the gesture; this just says what to reload.
  usePullRefreshListener(() => refreshFeeds());

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Client-side expiry is PRESENTATION only: a Moment disappearing here mirrors
  // the server, which already refuses it. Access control is never a client timer.
  const liveFeed = useMemo(() => feed.filter((moment) => Date.parse(moment.expiresAt) > nowMs), [feed, nowMs]);
  const shown = useMemo(
    () => (authorFilter ? liveFeed.filter((moment) => moment.authorId === authorFilter) : liveFeed),
    [liveFeed, authorFilter]
  );

  // ---------------------------------------------------------------------------
  // Exact-Moment targeting (?moment=<id>)
  // ---------------------------------------------------------------------------
  //
  // The target is resolved against the feed this tab ALREADY renders, so an id
  // the viewer is not authorised for simply does not match. Expired, deleted,
  // blocked, wrong-tab and never-existed all land on the same neutral notice.
  const momentParam = searchParams.get(MOMENT_PARAM);

  // Resolved during RENDER, not in an effect: this is a pure function of the
  // URL and the already-authorised feed, so there is no state to synchronise
  // and no cascading re-render. The effect below only does the genuinely
  // external work — scrolling and rewriting the URL.
  const feedLoaded = liveFeed.length > 0 || moments.length > 0 || spotlight.length > 0;
  const target = useMemo<MomentTargetResolution>(
    () => (feedLoaded ? resolveMomentTarget(momentParam, liveFeed, { nowMs }) : { status: "none" }),
    [feedLoaded, momentParam, liveFeed, nowMs]
  );
  const targetNotice = target.status === "unavailable" && !noticeDismissed ? target.message : "";

  // Consume each target once: without this the effect would re-scroll on every
  // unrelated re-render (a reaction, a refresh) and fight the user's scrolling.
  const consumedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!momentParam || !feedLoaded || consumedTargetRef.current === momentParam) return;
    consumedTargetRef.current = momentParam;

    if (target.status === "found") {
      // Scroll to the card in place. The feed keeps its order — the target is
      // brought into view, never moved to the front.
      const node = document.getElementById(momentAnchorId(target.moment.id));
      node?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center"
      });
      node?.focus?.({ preventScroll: true });
    }

    // Drop the param either way: replace, not push, so Back still goes to the
    // screen the viewer came from rather than re-triggering the jump.
    router.replace(urlWithoutMomentParam(tab) as Route, { scroll: false });
  }, [momentParam, feedLoaded, target, router, tab]);

  // The avatar row is derived from the ALREADY-AUTHORIZED feed, so it can never
  // surface a Muddy whose Moment the feed excluded.
  const ring = useMemo(() => {
    const byAuthor = new Map<
      string,
      { authorId: string; name: string; avatarUrl: string | null; momentCount: number; hasUnseen: boolean }
    >();
    for (const moment of liveFeed) {
      const entry = byAuthor.get(moment.authorId) ?? {
        authorId: moment.authorId,
        name: moment.authorName,
        avatarUrl: moment.authorAvatarUrl,
        momentCount: 0,
        hasUnseen: false
      };
      entry.momentCount += 1;
      if (!seenIds.has(moment.id)) entry.hasUnseen = true;
      byAuthor.set(moment.authorId, entry);
    }
    return [...byAuthor.values()].sort((a, b) => {
      if ((a.name === "You") !== (b.name === "You")) return a.name === "You" ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [liveFeed, seenIds]);

  /**
   * Opens the full-screen layer and, in the background, upgrades the media to
   * the full-size asset. The layer shows the already-loaded feed image
   * immediately, so it never waits on the network.
   */
  function openFullScreen(moment: VisibleMoment) {
    setFullScreenFor(moment);
    setFullResUrl(null);
    if (moment.contentType === "text") return;
    void getMomentFullMediaUrlAction(moment.id).then((url) => {
      // Guard against a late response arriving after the viewer moved on.
      setFullScreenFor((current) => {
        if (current?.id === moment.id && url) setFullResUrl(url);
        return current;
      });
    });
  }

  function refreshFeeds() {
    startTransition(async () => {
      const [fresh, freshSpotlight] = await Promise.all([
        getMomentFeedAction(),
        openMomentsEnabled ? getOpenMomentFeedAction() : Promise.resolve([])
      ]);
      setMoments(fresh);
      setSpotlight(freshSpotlight);
      if (openMomentsEnabled) setMyTuneIns(await getMyTuneInsAction());
    });
  }

  function patch(momentId: string, updater: (entry: VisibleMoment) => VisibleMoment) {
    const apply = (list: VisibleMoment[]) => list.map((entry) => (entry.id === momentId ? updater(entry) : entry));
    setMoments(apply);
    setSpotlight(apply);
  }

  /**
   * Records a view once per session. Stable identity so the intersection
   * observer below is not torn down and rebuilt on every render. The server
   * dedupes for real, one row per viewer per Moment.
   */
  const markViewed = useCallback((momentId: string, isAuthor: boolean) => {
    if (isAuthor) return;
    setSeenIds((current) => {
      if (current.has(momentId)) return current;
      const next = new Set(current);
      next.add(momentId);
      return next;
    });
    void recordMomentViewAction(momentId);
  }, []);

  function react(moment: VisibleMoment, reaction: MomentReactionId) {
    const previous = moment.myReaction;
    // Optimistic, and the breakdown is adjusted too so the compact aggregate
    // stays coherent. Changing a reaction replaces it rather than adding one.
    patch(moment.id, (entry) => {
      const breakdown = { ...entry.reactionBreakdown };
      if (previous) breakdown[previous] = Math.max(0, (breakdown[previous] ?? 1) - 1);
      breakdown[reaction] = (breakdown[reaction] ?? 0) + 1;
      return {
        ...entry,
        myReaction: reaction,
        reactionBreakdown: breakdown,
        reactionCount: previous ? entry.reactionCount : entry.reactionCount + 1
      };
    });
    startTransition(async () => {
      const result = await reactToMomentAction(moment.id, reaction);
      if (!result.ok) {
        setFeedback(result.message);
        refreshFeeds();
      }
    });
  }

  function unreact(moment: VisibleMoment) {
    const previous = moment.myReaction;
    patch(moment.id, (entry) => {
      const breakdown = { ...entry.reactionBreakdown };
      if (previous) breakdown[previous] = Math.max(0, (breakdown[previous] ?? 1) - 1);
      return {
        ...entry,
        myReaction: null,
        reactionBreakdown: breakdown,
        reactionCount: Math.max(0, entry.reactionCount - 1)
      };
    });
    startTransition(async () => {
      const result = await removeMomentReactionAction(moment.id);
      if (!result.ok) {
        setFeedback(result.message);
        refreshFeeds();
      }
    });
  }

  async function handleTuneIn(creatorId: string, sourceMomentId?: string): Promise<boolean> {
    const result = await tuneInAction(creatorId, sourceMomentId);
    if (result.ok) {
      setSpotlight((current) =>
        current.map((entry) =>
          entry.authorId === creatorId
            ? { ...entry, creatorTunedIn: true, creatorTunedInCount: entry.creatorTunedInCount + 1 }
            : entry
        )
      );
      setHub((current) =>
        current?.creatorId === creatorId
          ? { ...current, viewerTunedIn: true, tunedInCount: current.tunedInCount + 1 }
          : current
      );
    } else {
      setFeedback(result.message);
    }
    return result.ok;
  }

  async function handleTuneOut(creatorId: string): Promise<boolean> {
    const result = await tuneOutAction(creatorId);
    if (result.ok) {
      setSpotlight((current) =>
        current.map((entry) =>
          entry.authorId === creatorId
            ? { ...entry, creatorTunedIn: false, creatorTunedInCount: Math.max(0, entry.creatorTunedInCount - 1) }
            : entry
        )
      );
      setHub((current) =>
        current?.creatorId === creatorId
          ? { ...current, viewerTunedIn: false, tunedInCount: Math.max(0, current.tunedInCount - 1) }
          : current
      );
      setMyTuneIns((current) => current.filter((entry) => entry.creatorId !== creatorId));
    } else {
      setFeedback(result.message);
    }
    return result.ok;
  }

  function openHub(creatorId: string) {
    startTransition(async () => {
      const result = await getMomentsCreatorHubAction(creatorId);
      if (result) setHub(result);
      else setFeedback("That creator isn't available.");
    });
  }

  const loadTuneIns = useCallback(() => {
    startTransition(async () => setMyTuneIns(await getMyTuneInsAction()));
  }, []);

  // Loaded when Spotlight is opened, so the strip reflects unviewed content
  // without any polling.
  useEffect(() => {
    if (tab === "air") loadTuneIns();
  }, [tab, loadTuneIns]);

  const fetchCreatorMoments = useCallback(
    (creatorId: string) => getCreatorSpotlightMomentsAction(creatorId),
    []
  );
  const viewerLane = useTunedInLane(fetchCreatorMoments);

  function openTunedInCreator(entry: TuneInEntry) {
    // Straight into their current Moment when there is one; the hub is only the
    // fallback for a creator with nothing live.
    if (entry.liveMomentCount > 0) viewerLane.open(myTuneIns, entry);
    else openHub(entry.creatorId);
  }

  function selectTab(next: MomentTab) {
    setAuthorFilter(null);
    // replace, not push: switching tabs should not stack history entries
    // between the user and the page they arrived from.
    router.replace(`/moments?tab=${next}` as Route, { scroll: false });
    if (next === "air") void recordSpotlightViewedAction();
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 pb-4 md:pt-4">
      <PageHeader title="Moments" />

      <header className="flex items-center justify-between gap-3 pt-1 md:pt-0">
        {/* Hidden on mobile: the shared header carries the title there. */}
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">Moments</h1>
        <div className="flex items-center gap-1.5">
          {openMomentsEnabled ? (
            <button
              type="button"
              onClick={() => {
                setManageOpen(true);
                loadTuneIns();
              }}
              aria-label="My Tuned In"
              title="My Tuned In"
              className="focus-ring safe-motion grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <TuneInIcon className="h-5 w-5" />
            </button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => setComposerOpen(true)}
            data-tour-id={TOUR_TARGET_IDS.MOMENTS_SHARE}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Share
          </Button>
        </div>
      </header>

      {openMomentsEnabled ? (
        <div
          role="tablist"
          aria-label="Moments feeds"
          data-tour-id={TOUR_TARGET_IDS.MOMENTS_TABS}
          className="flex gap-1.5 rounded-full bg-secondary/50 p-1"
        >
          {MOMENT_TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              data-tour-id={option === "air" ? TOUR_TARGET_IDS.MOMENTS_AIR_TAB : undefined}
              data-tour-active={option === "air" && tab === option ? "true" : undefined}
              onClick={() => selectTab(option)}
              className={cn(
                "focus-ring safe-motion min-h-9 flex-1 rounded-full text-sm font-semibold capitalize",
                tab === option
                  ? option === "air"
                    ? "bg-orange-500 text-white"
                    : "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              {option}
              {/* A quiet dot when Air has something live, so the tab says so
                  without the page having to shout it elsewhere. */}
              {option === "air" && spotlight.length > 0 && tab !== "air" ? (
                <span
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-orange-500 align-middle"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {targetNotice ? (
        // role="status" so a screen reader is told the target could not be
        // shown, without stealing focus from the page.
        <p
          role="status"
          className="flex items-center justify-between gap-3 rounded-[1rem] bg-secondary px-3 py-2.5 text-sm text-muted-foreground"
        >
          {targetNotice}
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            aria-label="Dismiss"
            className="focus-ring -mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-background/60"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      ) : null}

      {feedback ? (
        <p
          role="status"
          className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 px-3 py-2.5 text-sm text-orange-800 dark:text-orange-50"
        >
          {feedback}
        </p>
      ) : null}

      {tab === "all" ? (
        <AllTab
          sections={sections}
          trulyEmpty={trulyEmpty}
          nowMs={nowMs}
          viewerName={viewerName}
          viewerAvatarUrl={viewerAvatarUrl}
          onCompose={() => setComposerOpen(true)}
          onSeeAll={selectTab}
        />
      ) : tab === "moments" ? (
        <>
          <div data-tour-id={TOUR_TARGET_IDS.MOMENTS_YOURS}>
            <MomentsRing
              entries={ring}
              selfName={viewerName}
              selfAvatarUrl={viewerAvatarUrl}
              onCreate={() => setComposerOpen(true)}
              onOpenAuthor={(authorId) => setAuthorFilter((current) => (current === authorId ? null : authorId))}
            />
          </div>

          {authorFilter ? (
            <button
              type="button"
              onClick={() => setAuthorFilter(null)}
              className="focus-ring safe-motion inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-semibold"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Showing one Muddy
            </button>
          ) : null}

          <div data-tour-id={TOUR_TARGET_IDS.MOMENTS_FEED}>
          {shown.length === 0 ? (
            trulyEmpty ? (
              // Full onboarding only when the viewer has nothing at all.
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <UserAvatar src={viewerAvatarUrl} name={viewerName} size="lg" decorative />
                <div>
                  <p className="text-base font-semibold">Nothing new from your Muddies</p>
                  <p className="mt-1 text-sm text-muted-foreground">Share a Moment or check back later.</p>
                </div>
                <Button type="button" onClick={() => setComposerOpen(true)}>
                  Share a Moment
                </Button>
              </div>
            ) : (
              // Air has something, so this tab stays quiet rather than
              // repeating the whole onboarding pitch.
              <p className="py-10 text-center text-sm text-muted-foreground">No Moments yet.</p>
            )
          ) : (
            <ul className="space-y-4">
              {shown.map((moment, index) => (
                // The anchor the ?moment= target scrolls to and focuses.
                <li key={moment.id} id={momentAnchorId(moment.id)} tabIndex={-1}>
                  <PrivateMomentCard
                    moment={moment}
                    nowMs={nowMs}
                    priority={index === 0}
                    pending={isPending}
                    menuOpen={menuFor === moment.id}
                    onToggleMenu={(open) => setMenuFor(open ? moment.id : null)}
                    onSeen={markViewed}
                    onReact={(reaction) => react(moment, reaction)}
                    onRemoveReaction={() => unreact(moment)}
                    onRetryMedia={refreshFeeds}
                    onOpenFullScreen={() => openFullScreen(moment)}
                    onReport={() => {
                      setMenuFor(null);
                      setReportFor(moment);
                    }}
                    onDelete={() => {
                      setMenuFor(null);
                      startTransition(async () => {
                        const result = await deleteMomentAction(moment.id);
                        setFeedback(result.message);
                        if (result.ok) refreshFeeds();
                      });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          </div>
        </>
      ) : (
        <>
          <TunedInStrip
            entries={myTuneIns}
            onOpenCreator={openTunedInCreator}
            onManage={() => setManageOpen(true)}
          />
          <div data-tour-id={TOUR_TARGET_IDS.MOMENTS_FEED}>
          {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No one is on Air right now.</p>
      ) : (
        <ul className="space-y-5">
          {shown.map((moment, index) => (
            <li key={moment.id} id={momentAnchorId(moment.id)} tabIndex={-1}>
              <SpotlightCard
                moment={moment}
                nowMs={nowMs}
                priority={index === 0}
                pending={isPending}
                menuOpen={menuFor === moment.id}
                onToggleMenu={(open) => setMenuFor(open ? moment.id : null)}
                onSeen={markViewed}
                onReact={(reaction) => react(moment, reaction)}
                onRemoveReaction={() => unreact(moment)}
                onRetryMedia={refreshFeeds}
                onOpenFullScreen={() => openFullScreen(moment)}
                onOpenCreator={openHub}
                onTuneIn={handleTuneIn}
                onTuneOut={handleTuneOut}
                onReport={() => {
                  setMenuFor(null);
                  setReportFor(moment);
                }}
                onDelete={() => {
                  setMenuFor(null);
                  startTransition(async () => {
                    const result = await deleteMomentAction(moment.id);
                    setFeedback(result.message);
                    if (result.ok) refreshFeeds();
                  });
                }}
              />
            </li>
          ))}
        </ul>
          )}
          </div>
        </>
      )}

      {/* One full-screen layer for whichever Moment was tapped. Not a feed:
          it shows that Moment's media and nothing else. */}
      {fullScreenFor ? (
        <MomentMediaViewer
          moment={fullScreenFor}
          // Rotated so the tapped Moment leads and the rest continue in the
          // feed's own order. `shown` itself is never reordered — the page
          // behind stays in canonical order.
          sequence={rotateSequenceToTarget(shown, fullScreenFor.id)}
          onActiveChange={(active) => {
            // replace, not push: stepping through the sequence must not add a
            // history entry per swipe, or Back would unwind step by step
            // instead of leaving the layer.
            window.history.replaceState(
              window.history.state,
              "",
              `/moments?tab=${tab}&${MOMENT_PARAM}=${active.id}`
            );
          }}
          open
          fullResUrl={fullResUrl}
          onClose={() => {
            setFullScreenFor(null);
            setFullResUrl(null);
            // Drop the Moment id but keep the tab, so closing returns to the
            // same tab and the same scroll position without a navigation.
            window.history.replaceState(window.history.state, "", urlWithoutMomentParam(tab));
          }}
          initialVideoTime={videoPositions.current.get(fullScreenFor.id) ?? 0}
          onVideoTimeChange={(seconds) => videoPositions.current.set(fullScreenFor.id, seconds)}
        />
      ) : null}

      <MomentComposer
        open={composerOpen}
        muddies={muddies}
        spotlightEnabled={openMomentsEnabled}
        closeFriendsAvailable={closeFriendsAvailable}
        birthdayTemplateAvailable={birthdayTemplateAvailable}
        onOpenChange={setComposerOpen}
        onPublished={(message) => {
          setFeedback(message);
          refreshFeeds();
          router.refresh();
        }}
      />

      <CreatorHubModal
        hub={hub}
        onOpenChange={(next) => {
          if (!next) setHub(null);
        }}
        onTuneIn={handleTuneIn}
        onTuneOut={handleTuneOut}
      />

      <TunedInManageModal
        open={manageOpen}
        entries={myTuneIns}
        onOpenChange={setManageOpen}
        onTuneOut={handleTuneOut}
      />

      {viewerLane.lane.length > 0 ? (
        <TunedInViewer
          lane={viewerLane.lane}
          index={viewerLane.index}
          pending={isPending}
          onClose={viewerLane.close}
          onIndexChange={viewerLane.setIndex}
          onSeen={markViewed}
          onReact={react}
          onRemoveReaction={unreact}
        />
      ) : null}

      <ReportModal
        moment={reportFor}
        onOpenChange={(next) => {
          if (!next) setReportFor(null);
        }}
        onReported={(message) => {
          setFeedback(message);
          refreshFeeds();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Marks a card seen once it genuinely enters the viewport, rather than counting
 * everything the server happened to send. `onSeen` must be stable (the parent
 * memoises it), so the observer is created once per card.
 */
function useSeenOnce(momentId: string, isAuthor: boolean, onSeen: (momentId: string, isAuthor: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onSeen(momentId, isAuthor);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [momentId, isAuthor, onSeen]);
  return ref;
}

type CardProps = {
  moment: VisibleMoment;
  nowMs: number;
  priority: boolean;
  pending: boolean;
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onSeen: (momentId: string, isAuthor: boolean) => void;
  onReact: (reaction: MomentReactionId) => void;
  onRemoveReaction: () => void;
  onRetryMedia: () => void;
  /** Opens this Moment's media full-screen. */
  onOpenFullScreen: () => void;
  onReport: () => void;
  onDelete: () => void;
};

/**
 * The All tab: one scrollable overview of everything the viewer can see.
 *
 * Sections render in the approved order — Personal, Air, More — and are
 * de-duplicated upstream by buildMomentSections, so scrolling can never show
 * the same Moment twice. Each section is omitted entirely when empty rather
 * than rendering a header over nothing.
 */
function AllTab({
  sections,
  trulyEmpty,
  nowMs,
  viewerName,
  viewerAvatarUrl,
  onCompose,
  onSeeAll
}: {
  sections: MomentSections;
  trulyEmpty: boolean;
  nowMs: number;
  viewerName: string;
  viewerAvatarUrl: string | null;
  onCompose: () => void;
  onSeeAll: (tab: MomentTab) => void;
}) {
  if (trulyEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <UserAvatar src={viewerAvatarUrl} name={viewerName} size="lg" decorative />
        <div>
          <p className="text-base font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Share a Moment to get started.</p>
        </div>
        <Button type="button" onClick={onCompose}>
          Share a Moment
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-tour-id={TOUR_TARGET_IDS.MOMENTS_FEED}>
      <MomentRail
        id="all-personal"
        title="Personal Moments"
        moments={sections.personal}
        onSeeAll={() => onSeeAll("moments")}
        nowMs={nowMs}
      />
      <MomentRail
        id="all-air"
        title="Air"
        air
        moments={sections.air}
        onSeeAll={() => onSeeAll("air")}
        nowMs={nowMs}
      />
      <MomentRail
        id="all-more"
        title="More Moments"
        moments={sections.more}
        onSeeAll={() => onSeeAll("moments")}
        nowMs={nowMs}
      />
    </div>
  );
}

/** One horizontal section of tiles. Renders nothing when it has no content. */
function MomentRail({
  id,
  title,
  moments,
  air = false,
  nowMs,
  onSeeAll
}: {
  id: string;
  title: string;
  moments: VisibleMoment[];
  air?: boolean;
  nowMs: number;
  onSeeAll: () => void;
}) {
  // Presentation-only expiry, mirroring the feed above: the server already
  // refuses an expired Moment, this just stops showing a stale one.
  const live = moments.filter((moment) => Date.parse(moment.expiresAt) > nowMs);
  if (live.length === 0) return null;

  return (
    <section aria-labelledby={id}>
      <PageSectionHeader id={id} title={title} onAction={onSeeAll} />
      {/* Same rail geometry as Home, Near and Suggestions. */}
      <ul className="-mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 [&::-webkit-scrollbar]:hidden">
        {live.map((moment, index) => (
          <li key={moment.id}>
            <MomentTile
              moment={moment}
              air={air}
              priority={index === 0}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrivateMomentCard(props: CardProps) {
  const ref = useSeenOnce(props.moment.id, props.moment.isAuthor, props.onSeen);
  return (
    <div ref={ref} className="space-y-2.5 rounded-[1.25rem] border border-violet-400/15 bg-card/50 p-3">
      <MomentHeader moment={props.moment} nowMs={props.nowMs}>
        <MomentMenu {...props} />
      </MomentHeader>

      <MomentMedia
        moment={props.moment}
        onRetry={props.onRetryMedia}
        priority={props.priority}
        onOpenFullScreen={props.onOpenFullScreen}
      />

      {props.moment.caption ? <p className="text-sm leading-6">{props.moment.caption}</p> : null}

      <div data-tour-id={TOUR_TARGET_IDS.MOMENTS_REACTIONS} className="flex items-center justify-between gap-3">
        <ReactionControl
          moment={props.moment}
          pending={props.pending}
          onReact={props.onReact}
          onRemove={props.onRemoveReaction}
        />
        {props.moment.isAuthor && props.moment.audienceLabel ? (
          <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
            {props.moment.audienceLabel.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>

      <AuthorInsights moment={props.moment} />
    </div>
  );
}

function SpotlightCard(
  props: CardProps & {
    onOpenCreator: (creatorId: string) => void;
    onTuneIn: (creatorId: string, sourceMomentId?: string) => Promise<boolean>;
    onTuneOut: (creatorId: string) => Promise<boolean>;
  }
) {
  const ref = useSeenOnce(props.moment.id, props.moment.isAuthor, props.onSeen);
  return (
    <div ref={ref} className="spotlight-card space-y-3 rounded-[1.25rem] p-3">
      {/* Every card in this feed is a live, unexpired Air Moment, so its
          author is by definition currently on Air. */}
      <MomentHeader moment={props.moment} nowMs={props.nowMs} onOpenCreator={props.onOpenCreator} onAir>
        <div className="flex shrink-0 items-center gap-1.5">
          {!props.moment.isAuthor ? (
            <span data-tour-id={TOUR_TARGET_IDS.MOMENTS_TUNE_IN}>
              <TuneInButton
                creatorId={props.moment.authorId}
                // Attributes the tune-in to THIS Moment, which is what lets the
                // creator see "+36 Tuned In" for the post without learning who.
                sourceMomentId={props.moment.id}
                tunedIn={props.moment.creatorTunedIn}
                size="sm"
                onTuneIn={props.onTuneIn}
                onTuneOut={props.onTuneOut}
              />
            </span>
          ) : null}
          <MomentMenu {...props} />
        </div>
      </MomentHeader>

      <MomentMedia
        moment={props.moment}
        onRetry={props.onRetryMedia}
        aspect="portrait"
        priority={props.priority}
        onOpenFullScreen={props.onOpenFullScreen}
      />

      {props.moment.caption ? <p className="text-sm leading-6">{props.moment.caption}</p> : null}

      <div data-tour-id={TOUR_TARGET_IDS.MOMENTS_REACTIONS} className="flex items-center justify-between gap-3">
        <ReactionControl
          moment={props.moment}
          pending={props.pending}
          onReact={props.onReact}
          onRemove={props.onRemoveReaction}
        />
        {props.moment.creatorTunedInCount > 0 ? <TunedInCount count={props.moment.creatorTunedInCount} /> : null}
      </div>

      <AuthorInsights moment={props.moment} />
    </div>
  );
}

/**
 * The overflow menu.
 *
 * Uses the shared `AppMenu` (Radix DropdownMenu) rather than a hand-rolled
 * panel. The previous version was a plain absolutely-positioned div, which is
 * exactly why tapping empty space left it open: nothing was listening for an
 * outside press or Escape. Radix brings dismiss-on-outside-press,
 * dismiss-on-Escape, focus return, arrow-key navigation and collision flipping,
 * so this behaves like every other menu in the app instead of being a one-off.
 */
function MomentMenu({
  moment,
  menuOpen,
  onToggleMenu,
  onReport,
  onDelete
}: Pick<CardProps, "moment" | "menuOpen" | "onToggleMenu" | "onReport" | "onDelete">) {
  return (
    <AppMenu
      label="Moment options"
      open={menuOpen}
      onOpenChange={onToggleMenu}
      items={
        moment.isAuthor
          ? [
              {
                id: "delete",
                label: "Delete",
                destructive: true,
                icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                onSelect: onDelete
              }
            ]
          : [
              // Report and block are the EXISTING systems. Disapproval is
              // moderation, never a negative reaction.
              {
                id: "report",
                label: "Report",
                icon: <Flag className="h-4 w-4" aria-hidden="true" />,
                onSelect: onReport
              }
            ]
      }
      trigger={
        <button
          type="button"
          aria-label="More options"
          className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Creator hub
// ---------------------------------------------------------------------------

/**
 * A creator's Moments hub: a content surface layered on the existing profile,
 * not a replacement for it.
 *
 * Shows a name, an avatar, an aggregate Tune In count and a live-Moment count.
 * Nothing else — no location, status, Muddy list or private profile field — so
 * Spotlight cannot become a way to learn what a creator did not publish.
 *
 * Add Muddy and Tune In stay SEPARATE actions, because they mean different
 * things: a mutual private relationship versus one-way content interest.
 */
function CreatorHubModal({
  hub,
  onOpenChange,
  onTuneIn,
  onTuneOut
}: {
  hub: MomentsCreatorHub | null;
  onOpenChange: (open: boolean) => void;
  onTuneIn: (creatorId: string, sourceMomentId?: string) => Promise<boolean>;
  onTuneOut: (creatorId: string) => Promise<boolean>;
}) {
  return (
    <Modal open={hub !== null} onOpenChange={onOpenChange} title="Moments" variant="sheet" compact>
      {hub ? (
        <div className="space-y-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <UserAvatar src={hub.avatarUrl} name={hub.name} size="xl" decorative />
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-semibold">{hub.name}</p>
              {hub.liveSpotlightCount > 0 ? <OnAirBadge /> : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <TunedInCount count={hub.tunedInCount} />
              <span className="text-xs text-muted-foreground">
                {hub.liveSpotlightCount} live {hub.liveSpotlightCount === 1 ? "Moment" : "Moments"}
              </span>
            </div>
          </div>

          {!hub.isSelf ? (
            <div className="flex flex-wrap justify-center gap-2">
              {!hub.viewerIsMuddy ? (
                <Link
                  href="/friends"
                  prefetch={false}
                  className="focus-ring safe-motion inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-secondary"
                >
                  Add Muddy
                </Link>
              ) : null}
              <TuneInButton
                creatorId={hub.creatorId}
                tunedIn={hub.viewerTunedIn}
                onTuneIn={onTuneIn}
                onTuneOut={onTuneOut}
              />
            </div>
          ) : null}

          <p className="text-xs leading-5 text-muted-foreground">
            Tune In is one-way and private.{" "}
            {hub.isSelf
              ? "Nobody can see who tuned in to you, and you only ever see the total."
              : `${hub.name.split(" ")[0]} is never told who tuned in.`}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function ReportModal({
  moment,
  onOpenChange,
  onReported
}: {
  moment: VisibleMoment | null;
  onOpenChange: (open: boolean) => void;
  onReported: (message: string) => void;
}) {
  const [category, setCategory] = useState<string>("harassment");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal
      open={moment !== null}
      onOpenChange={onOpenChange}
      title="Report this Moment"
      description="We'll hide it from you straight away. Your report stays private."
      variant="sheet"
      compact
      footer={
        <Button
          type="button"
          variant="danger"
          className="w-full"
          disabled={isPending || !moment}
          onClick={() =>
            startTransition(async () => {
              if (!moment) return;
              // The EXISTING report/block architecture. Blocking a creator
              // removes their content through the canonical block rules.
              const result = await reportContentAction({
                contentType: "moment",
                contentId: moment.id,
                category,
                details: details.trim() || undefined,
                alsoHide: true,
                alsoBlock
              });
              onReported(result.message);
              if (result.ok) {
                setCategory("harassment");
                setDetails("");
                setAlsoBlock(false);
                onOpenChange(false);
              }
            })
          }
        >
          {isPending ? "Sending…" : "Report"}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {REPORT_CATEGORIES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCategory(option.id)}
              aria-pressed={category === option.id}
              className={cn(
                "focus-ring safe-motion min-h-9 rounded-full border px-3 text-xs font-medium",
                category === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Textarea
          value={details}
          maxLength={1000}
          rows={2}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Anything else we should know? (optional)"
          aria-label="Report details"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(event) => setAlsoBlock(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-orange-500"
          />
          Also block {moment?.authorName}
        </label>
      </div>
    </Modal>
  );
}
