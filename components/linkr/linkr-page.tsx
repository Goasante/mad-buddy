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
};

type View = "discover" | "filters" | "profile" | "settings" | "how" | "event-intro";

export function LinkrPage({
  initialProfile,
  initialCandidates,
  me,
  blockedCount,
  eventContext
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
    startTransition(async () => {
      const result = await undoLinkrActionAction();
      if (result.ok) {
        setIndex((current) => Math.max(0, current - 1));
        setCanUndo(false);
      } else {
        setNotice(result.message);
      }
    });
  }, []);
  /**
   * Identity handlers are GONE.
   *
   * Uploading a photo and setting a date of birth are Profile's job. Linkr
   * sends people there and re-reads the result; it no longer holds an uploader,
   * a date picker, or the handlers that fed them.
   */
  const goToProfile = useCallback(() => {
    // Deep-links to the identity section rather than the top of Profile, so
    // somebody sent here to add a photo is not made to hunt for the field.
    router.push("/profile?section=identity" as Route);
  }, [router]);


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
        busy={pending}
        error={notice}
        onCompleteProfile={goToProfile}
        /**
         * The DERIVED age, never a raw date of birth, and a BOOLEAN for the
         * photo rather than a URL. Activation needs to know only whether the
         * person qualifies -- it neither shows nor collects identity.
         */
        age={profile?.age ?? null}
        hasProfilePhoto={(profile?.photos.length ?? 0) > 0}
        initialIntent={profile?.intent ?? "friends"}
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
        busy={pending}
        onClose={() => setView("discover")}
        onApply={(next) => {
          startTransition(async () => {
            await updateLinkrSettingsAction({
              discoveryDistance: next.discoveryDistance,
              onlyActiveNow: next.onlyActiveNow,
              onlyNewToday: next.onlyNewToday,
              requirePhotos: next.requirePhotos
            });
            if (next.intent !== profile.intent) {
              await updateLinkrProfileAction({ intent: next.intent });
            }
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
          });
        }}
      />
    );
  }

  if (view === "profile") {
    return (
      <LinkrProfileEditor
        profile={profile}
        busy={pending}
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
        busy={pending}
        onBack={() => setView("discover")}
        onOpenFilters={() => setView("filters")}
        onOpenBlocked={() => router.push("/safety-center")}
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
                startTransition(async () => {
                  await updateLinkrSettingsAction({ discoveryDistance: option.id });
                  refreshDeck(option.id);
                });
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
            busy={pending}
          />
          <div className="linkr-safety">
            <button
              type="button"
              className="linkr-link"
              onClick={() => {
                startTransition(async () => {
                  await passCandidateAction({ targetId: current.userId, permanent: true, eventId });
                  advance();
                  setNotice("You won't see them again.");
                });
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
            setProfile((current) => (current ? { ...current, discoveryDistance: next } : current));
            startTransition(async () => {
              await updateLinkrSettingsAction({ discoveryDistance: next });
              refreshDeck(next);
            });
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
