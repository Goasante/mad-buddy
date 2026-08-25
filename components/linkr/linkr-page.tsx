"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Flag, MoreHorizontal, Settings, SlidersHorizontal, UserRound } from "lucide-react";

import {
  connectWithCandidateAction,
  disableLinkrAction,
  enableLinkrAction,
  loadLinkrCandidatesAction,
  passCandidateAction,
  undoLinkrActionAction,
  updateLinkrProfileAction,
  updateLinkrSettingsAction
} from "@/app/(app)/linkr-actions";
import { CandidateCard } from "@/components/linkr/candidate-card";
import { LinkrFilters, type LinkrFilterValues } from "@/components/linkr/linkr-filters";
import {
  EventModeIntro,
  HowLinkrWorks,
  LinkrEmptyState,
  LinkrMatchScreen
} from "@/components/linkr/linkr-moments";
import { LinkrOffScreen } from "@/components/linkr/linkr-activation";
import { LinkrProfileEditor } from "@/components/linkr/linkr-profile-editor";
import { LinkrSettings } from "@/components/linkr/linkr-settings";
import type { LinkrCandidate } from "@/lib/linkr/candidate-service";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";
import type { LinkrIntent } from "@/lib/linkr/intent";
import { profileHandoffHref } from "@/lib/navigation/handoff";
import { LINKR_DISTANCE_OPTIONS, type LinkrDistancePreference } from "@/lib/linkr/rules";

/**
 * Linkr 2.0.
 *
 * ONE QUESTION, ANSWERED WITH PEOPLE: "who might I want to connect with right
 * now?" Once Linkr is on, this component shows a person and two decisions.
 *
 * WHAT IS DELIBERATELY ABSENT, and does not live anywhere else in Linkr
 * either (brief §71):
 *   - Upcoming Social Plans
 *   - Join a Group
 *   - the permanent "Around You" proximity dashboard
 *   - the old candidate list and its configuration panel
 *
 * Those were removed rather than relocated. Plans and Groups have their own
 * destinations in the app's navigation and are reachable there; Linkr no
 * longer advertises them, including on the empty state, where filler content
 * is most tempting and least honest.
 */

export type LinkrPageProps = {
  initialProfile: LinkrOwnProfile | null;
  initialCandidates: LinkrCandidate[];
  me: { displayName: string; photo: string | null };
  blockedCount: number;
  /** Present only when the server authorised Event Mode for this visit. */
  eventContext: {
    id: string;
    name: string;
    whenLabel: string | null;
    venueLabel: string | null;
    poolLabel: string | null;
  } | null;
  /** Unsaved activation choice restored after a Profile handoff. */
  pendingIntent?: LinkrIntent | null;
};

type View = "discover" | "filters" | "profile" | "settings" | "how" | "event-intro";

export function LinkrPage({
  ...props
}: LinkrPageProps) {
  return (
    <div className="linkr-safe-screen" data-linkr-safe-area>
      <LinkrPageContent {...props} />
    </div>
  );
}

function LinkrPageContent({
  initialProfile,
  initialCandidates,
  me,
  blockedCount,
  eventContext,
  pendingIntent = null
}: LinkrPageProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [deck, setDeck] = useState<LinkrCandidate[]>(initialCandidates);
  const [index, setIndex] = useState(0);
  // Event Mode opens on its intro, which is the screen that explains why this
  // is not ordinary discovery.
  const [view, setView] = useState<View>(eventContext ? "event-intro" : "discover");
  const [match, setMatch] = useState<{
    displayName: string;
    photo: string | null;
    conversationId?: string;
  } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /**
   * Writes that must finish.
   *
   * Undo, settings and preference changes are mutations, and a transition may
   * be abandoned -- which would leave the deck and the server disagreeing
   * about a decision the person believes they made. Combined with `pending`
   * wherever the UI only needs to know something is in flight.
   */
  const [writing, setWriting] = useState(false);
  /**
   * Deck refills run in their OWN transition.
   *
   * Sharing `pending` with the card meant that topping the deck up in the
   * background disabled Pass and Connect -- the controls went dead for a
   * second or two in the middle of a session, for work the user never asked
   * for and cannot see. A background refill must never take the buttons away.
   */
  const [, startRefill] = useTransition();

  const enabled = Boolean(profile?.enabled);
  const current = deck[index] ?? null;
  const eventId = eventContext?.id ?? null;

  const distance: LinkrDistancePreference = profile?.discoveryDistance ?? "around_you";
  const canWiden = distance !== "wider";

  const refreshDeck = useCallback(
    (override?: LinkrDistancePreference) => {
      startTransition(async () => {
        const next = await loadLinkrCandidatesAction({
          eventId,
          distanceOverride: override ?? null
        });
        setDeck(next);
        setIndex(0);
      });
    },
    [eventId]
  );

  // Refill before the deck runs dry, so a decision is never followed by a
  // spinner where the next person should be. `refilling` guards against
  // firing a second fetch while one is already in flight.
  const refilling = useRef(false);
  useEffect(() => {
    if (!enabled || deck.length === 0 || index < deck.length - 3 || refilling.current) return;
    refilling.current = true;
    startRefill(async () => {
      try {
        const next = await loadLinkrCandidatesAction({ eventId });
        setDeck((existing) => {
          const seen = new Set(existing.map((candidate) => candidate.userId));
          const fresh = next.filter((candidate) => !seen.has(candidate.userId));
          return fresh.length > 0 ? [...existing, ...fresh] : existing;
        });
      } finally {
        refilling.current = false;
      }
    });
  }, [enabled, deck.length, index, eventId, startRefill]);

  const advance = useCallback(() => {
    setIndex((current) => current + 1);
    setCanUndo(true);
  }, []);

  /**
   * Pass and Connect ADVANCE FIRST, then write.
   *
   * The card is already gone by the time the request goes out, so making the
   * user wait on it would be waiting for nothing they can see. Deliberately
   * not wrapped in a transition: that would disable the controls for the
   * duration of a write whose result the deck does not depend on, and a deck
   * where the next decision has to wait for the previous one is the single
   * most obvious way this screen could feel broken.
   */
  const handlePass = useCallback(() => {
    if (!current) return;
    const targetId = current.userId;
    advance();
    void passCandidateAction({ targetId, eventId });
  }, [current, advance, eventId]);

  const handleConnect = useCallback(() => {
    if (!current) return;
    const targetId = current.userId;
    advance();
    void connectWithCandidateAction({ targetId, eventId }).then((result) => {
      // `matched` is the ONLY thing the server tells us. A one-sided Connect
      // is indistinguishable from here, which is exactly the intent: there is
      // no state in this component that could render "waiting for them".
      if (result.matched && result.matchedWith) {
        setMatch({
          displayName: result.matchedWith.displayName,
          photo: result.matchedWith.photo,
          conversationId: result.conversationId
        });
      }
    });
  }, [current, advance, eventId]);

  const handleUndo = useCallback(() => {
    /* Undo REVERSES A RECORDED DECISION, so the write must finish: an
     * abandoned request leaves the deck showing the person again while the
     * server still holds the Pass. Plain async work with its own flag. */
    void (async () => {
      setWriting(true);
      try {
        const result = await undoLinkrActionAction();
        if (result.ok) {
          setIndex((current) => Math.max(0, current - 1));
          setCanUndo(false);
        } else {
          setNotice(result.message);
        }
      } finally {
        setWriting(false);
      }
    })();
  }, []);
  /**
   * Identity handlers are GONE.
   *
   * Uploading a photo and setting a date of birth are Profile's job. Linkr
   * sends people there and re-reads the result; it no longer holds an uploader,
   * a date picker, or the handlers that fed them.
   */
  const goToProfile = useCallback((intent?: LinkrIntent) => {
    /* THE HANDOFF, as an actual contract.
     *
     * This used to push "/profile?section=identity" and stop. Profile never
     * read `section`, there was no return parameter at all, and the person
     * landed on a generic Profile page with no route back -- mid-way through
     * enabling Linkr, with nothing telling them how to finish. The comment
     * here claimed a deep link that the destination did not implement.
     *
     * profileHandoffHref builds all three parts: which section to open, where
     * to come back to, and who sent them (for the wording of the return
     * control). The return path carries the Event context so somebody who
     * started in Event Mode comes back to that Event's Linkr rather than the
     * general one -- and it is validated at both ends, because a returnTo in a
     * URL is an attacker-supplied string no matter who wrote the link. */
    const returnParams = new URLSearchParams();
    if (eventId) returnParams.set("eventId", eventId);
    if (intent) returnParams.set("intent", intent);
    const returnTo = returnParams.size ? `/linkr?${returnParams.toString()}` : "/linkr";
    router.push(
      profileHandoffHref({ section: "identity", returnTo, origin: "linkr" }) as Route
    );
  }, [router, eventId]);


  const handleEnable = useCallback(
    async (intent: LinkrIntent) => {
      const result = await enableLinkrAction({ intent });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setProfile((current) => (current ? { ...current, enabled: true, intent } : current));
      refreshDeck();
    },
    [refreshDeck]
  );

  const filterValues: LinkrFilterValues = useMemo(
    () => ({
      discoveryDistance: distance,
      intent: profile?.intent ?? "friends",
      onlyActiveNow: Boolean(profile?.onlyActiveNow),
      onlyNewToday: Boolean(profile?.onlyNewToday),
      requirePhotos: Boolean(profile?.requirePhotos)
    }),
    [profile, distance]
  );

  // --- Linkr off: the only thing on screen is the invitation. --------------
  if (!profile || !enabled) {
    if (view === "how") return <HowLinkrWorks onClose={() => setView("discover")} />;
    return (
      <LinkrOffScreen
        onEnable={handleEnable}
        onHowItWorks={() => setView("how")}
        busy={pending || writing}
        error={notice}
        onCompleteProfile={goToProfile}
        /**
         * The DERIVED age, never a raw date of birth, and a BOOLEAN for the
         * photo rather than a URL. Activation needs to know only whether the
         * person qualifies -- it neither shows nor collects identity.
         */
        age={profile?.age ?? null}
        hasProfilePhoto={(profile?.photos.length ?? 0) > 0}
        initialIntent={pendingIntent ?? profile?.intent ?? "friends"}
      />
    );
  }

  if (view === "how") return <HowLinkrWorks onClose={() => setView("discover")} />;

  if (view === "event-intro" && eventContext) {
    return (
      <EventModeIntro
        eventName={eventContext.name}
        whenLabel={eventContext.whenLabel}
        venueLabel={eventContext.venueLabel}
        poolLabel={eventContext.poolLabel}
        onBrowse={() => setView("discover")}
        onBack={() => router.back()}
      />
    );
  }

  if (view === "filters") {
    return (
      <LinkrFilters
        value={filterValues}
        busy={pending || writing}
        onClose={() => setView("discover")}
        onApply={(next) => {
          void (async () => {
            setWriting(true);
            /* THE RESULT WAS BEING DISCARDED. Both writes were fired and the
             * local state updated regardless, so a refused settings change --
             * rate limited, say -- left the UI showing preferences the server
             * had rejected, and the next deck refresh silently contradicted
             * them. A refusal now says so and the panel stays open. */
            const saved = await updateLinkrSettingsAction({
              discoveryDistance: next.discoveryDistance,
              onlyActiveNow: next.onlyActiveNow,
              onlyNewToday: next.onlyNewToday,
              requirePhotos: next.requirePhotos
            });
            if (!saved.ok) {
              setNotice(saved.message);
              setWriting(false);
              return;
            }
            if (next.intent !== profile.intent) {
              const intentSaved = await updateLinkrProfileAction({ intent: next.intent });
              if (!intentSaved.ok) {
                setNotice(intentSaved.message);
                setWriting(false);
                return;
              }
            }
            setWriting(false);
            setProfile((current) =>
              current
                ? {
                    ...current,
                    discoveryDistance: next.discoveryDistance,
                    intent: next.intent,
                    onlyActiveNow: next.onlyActiveNow,
                    onlyNewToday: next.onlyNewToday,
                    requirePhotos: next.requirePhotos
                  }
                : current
            );
            setView("discover");
            refreshDeck(next.discoveryDistance);
          })();
        }}
      />
    );
  }

  if (view === "profile") {
    return (
      <LinkrProfileEditor
        profile={profile}
        busy={pending || writing}
        onBack={() => setView("discover")}
        onPreview={() => setNotice("Your card is what other people see on the left.")}
        onSave={async (input) => {
          const result = await updateLinkrProfileAction(input);
          setNotice(result.message);
          if (result.ok) {
            setProfile((current) => (current ? { ...current, ...input } : current));
            setView("discover");
          }
        }}
        onEditProfilePhotos={goToProfile}
      />
    );
  }

  if (view === "settings") {
    return (
      <LinkrSettings
        profile={profile}
        hiddenCount={blockedCount}
        busy={pending || writing}
        onBack={() => setView("discover")}
        onOpenFilters={() => setView("filters")}
        /* The blocked list itself, not the Safety Centre that merely links
           to it. `hiddenCount` counts `blocked_users`, and discovery excludes
           on that same table, so this row must land where that list is
           actually managed. Safety Centre is safety tips and reporting: a
           different job, one hop further from the list. */
        onOpenBlocked={() => router.push("/friends?tab=blocked")}
        onToggleEnabled={async (next) => {
          const result = next ? await enableLinkrAction({ intent: profile.intent }) : await disableLinkrAction();
          if (result.ok) setProfile((current) => (current ? { ...current, enabled: next } : current));
          setNotice(result.message);
        }}
        onToggleEventMode={async (next) => {
          const result = await updateLinkrSettingsAction({ eventModeEnabled: next });
          if (result.ok) {
            setProfile((current) => (current ? { ...current, eventModeEnabled: next } : current));
          }
        }}
      />
    );
  }

  // --- Discovery. People, immediately. -------------------------------------
  return (
    <div className="linkr-shell">
      <header className="linkr-topbar">
        <h1 className="linkr-topbar__title">Linkr</h1>
        <div className="linkr-topbar__actions">
          <button type="button" onClick={() => setView("profile")} aria-label="My Linkr profile">
            <UserRound aria-hidden />
          </button>
          <button type="button" onClick={() => setView("filters")} aria-label="Filters">
            <SlidersHorizontal aria-hidden />
          </button>
          <button type="button" onClick={() => setView("settings")} aria-label="Linkr settings">
            <Settings aria-hidden />
          </button>
        </div>
      </header>

      {eventContext ? (
        <p className="linkr-event-banner">
          <span className="linkr-event-banner__dot" aria-hidden /> {eventContext.name}
        </p>
      ) : (
        <nav className="linkr-chips" aria-label="Discovery distance">
          {LINKR_DISTANCE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`linkr-chip linkr-chip--tab ${distance === option.id ? "is-selected" : ""}`}
              aria-pressed={distance === option.id}
              onClick={() => {
                setProfile((current) =>
                  current ? { ...current, discoveryDistance: option.id } : current
                );
                /* Optimistic BY DESIGN -- the chip highlights immediately --
                 * but the write still has to complete, and a refusal must roll
                 * the chip back rather than leave it showing a distance the
                 * server never accepted. */
                void (async () => {
                  const previous = distance;
                  const saved = await updateLinkrSettingsAction({ discoveryDistance: option.id });
                  if (!saved.ok) {
                    setProfile((current) =>
                      current ? { ...current, discoveryDistance: previous } : current
                    );
                    setNotice(saved.message);
                    return;
                  }
                  refreshDeck(option.id);
                })();
              }}
            >
              {option.label}
            </button>
          ))}
        </nav>
      )}

      {current ? (
        <>
          <CandidateCard
            key={current.userId}
            candidate={current}
            onPass={handlePass}
            onConnect={handleConnect}
            onUndo={handleUndo}
            canUndo={canUndo}
            busy={pending || writing}
          />
          <div className="linkr-safety">
            <button
              type="button"
              className="linkr-link"
              onClick={() => {
                /* A PERMANENT Pass. The message promises they will not appear
                 * again, so the write cannot be abandoned -- and the promise
                 * is only made once the server has actually recorded it. */
                void (async () => {
                  const targetId = current.userId;
                  advance();
                  const result = await passCandidateAction({ targetId, permanent: true, eventId });
                  setNotice(
                    result.ok
                      ? "You won't see them again."
                      : "That didn't save. They may appear again."
                  );
                })();
              }}
            >
              <MoreHorizontal aria-hidden /> Don&apos;t show me again
            </button>
            <button
              type="button"
              className="linkr-link"
              onClick={() =>
                router.push(`/safety?report=${encodeURIComponent(current.userId)}` as Route)
              }
            >
              <Flag aria-hidden /> Report
            </button>
          </div>
        </>
      ) : (
        <LinkrEmptyState
          canWiden={canWiden}
          onWiden={() => {
            const next: LinkrDistancePreference = distance === "very_close" ? "around_you" : "wider";
            const previous = distance;
            setProfile((current) => (current ? { ...current, discoveryDistance: next } : current));
            void (async () => {
              const saved = await updateLinkrSettingsAction({ discoveryDistance: next });
              if (!saved.ok) {
                // Put the preference back rather than claim a wider search.
                setProfile((current) =>
                  current ? { ...current, discoveryDistance: previous } : current
                );
                setNotice(saved.message);
                return;
              }
              refreshDeck(next);
            })();
          }}
        />
      )}

      {match ? (
        <LinkrMatchScreen
          me={me}
          them={{ displayName: match.displayName, photo: match.photo }}
          onSayHi={() => {
            // The canonical conversation, opened directly. `as Route` matches
            // how every other dynamic push in the app satisfies typed routes.
            const target = (
              match.conversationId
                ? `/messages?conversation=${match.conversationId}`
                : "/messages"
            ) as Route;
            setMatch(null);
            router.push(target);
          }}
          onKeepDiscovering={() => setMatch(null)}
        />
      ) : null}

      {notice ? (
        <p className="linkr-notice" role="status" onAnimationEnd={() => setNotice(null)}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
