"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flag, Hand, MoreHorizontal } from "lucide-react";

import {
  connectWithCandidateAction,
  disableLinkrAction,
  enableLinkrAction,
  loadClickedPeopleAction,
  loadLinkrCandidatesAction,
  loadPendingClicksAction,
  passCandidateAction,
  resolveMutualDestinationAction,
  undoLinkrActionAction,
  updateLinkrProfileAction,
  updateLinkrSettingsAction
} from "@/app/(app)/linkr-actions";
import { AppMenu } from "@/components/ui/app-dropdown";
import { CandidateCard } from "@/components/linkr/candidate-card";
import { LinkrFilters, type LinkrFilterValues } from "@/components/linkr/linkr-filters";
import {
  EventModeIntro,
  HowLinkrWorks,
  LinkrEmptyState,
  LinkrMatchScreen
} from "@/components/linkr/linkr-moments";
import { LinkrCollections } from "@/components/linkr/linkr-collections";
import { LinkrMutualBanner } from "@/components/linkr/linkr-mutual-banner";
import { LinkrOffScreen } from "@/components/linkr/linkr-activation";
import { LinkrPreview } from "@/components/linkr/linkr-preview";
import { LinkrProfileEditor } from "@/components/linkr/linkr-profile-editor";
import { LinkrSettings } from "@/components/linkr/linkr-settings";
import type { LinkrCandidate } from "@/lib/linkr/candidate-service";
import type { ClickedPerson, PendingClick } from "@/lib/linkr/collections-service";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";
import type { LinkrIntent } from "@/lib/linkr/intent";
import { cameFromInsideApp } from "@/lib/navigation/entry-origin";
import { profileHandoffHref } from "@/lib/navigation/handoff";
import { LINKR_COPY, LINKR_DISTANCE_OPTIONS, type LinkrDistancePreference } from "@/lib/linkr/rules";

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
  /** From a mutual-connection notification; re-resolved before it opens. */
  requestedConnectionId?: string | null;
};

type View = "discover" | "filters" | "profile" | "settings" | "how" | "event-intro" | "clicked" | "preview";

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
  pendingIntent = null,
  requestedConnectionId = null
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
    hasConversation?: boolean;
  } | null>(null);
  /**
   * The mutual news for the person who clicked FIRST. A banner, never a modal:
   * see LinkrMutualBanner for why hijacking an in-flight swipe is unsafe.
   */
  const [mutualBanner, setMutualBanner] = useState<{
    name: string;
    connectionId: string;
  } | null>(null);
  // The person completing reciprocity already receives the full mutual
  // screen. Remember that connection so its symmetrical notification cannot
  // reappear as a redundant first-connector banner after the screen closes.
  const completedConnectionId = useRef<string | null>(null);
  /**
   * The candidate whose Connect is still in flight. Covers the gap between
   * tapping Connect and learning the connection id.
   */
  const connectingTargetId = useRef<string | null>(null);
  const [clicked, setClicked] = useState<ClickedPerson[]>([]);
  const [pendingClicks, setPendingClicks] = useState<PendingClick[]>([]);
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
    /**
     * Claim the reciprocity BEFORE the request, not after it.
     *
     * The symmetrical notification is written by the server the moment the
     * connection forms, so it can reach this tab while connectWithCandidate is
     * still in flight. Recording the id only in the response left a window in
     * which the live handler saw an unclaimed connection and raised a banner
     * for the very match this person is about to be shown full screen.
     *
     * The target id is enough to recognise it: the handler resolves the
     * connection anyway and learns who is on the other side.
     */
    connectingTargetId.current = targetId;
    advance();
    void connectWithCandidateAction({ targetId, eventId }).then((result) => {
      // `matched` is the ONLY thing the server tells us. A one-sided Connect
      // is indistinguishable from here, which is exactly the intent: there is
      // no state in this component that could render "waiting for them".
      if (result.matched && result.matchedWith) {
        completedConnectionId.current = result.connectionId ?? null;
        setMutualBanner((current) =>
          current?.connectionId === result.connectionId ? null : current
        );
        setMatch({
          displayName: result.matchedWith.displayName,
          photo: result.matchedWith.photo,
          conversationId: result.conversationId
        });
      }
      // Release the in-flight claim either way. Holding it would suppress a
      // genuine later banner from the same person -- a one-sided Connect that
      // they return tomorrow is exactly the case this must still announce.
      if (connectingTargetId.current === targetId) connectingTargetId.current = null;
    }).catch(() => {
      // A failed request must not leave the claim stuck: that would silently
      // mute this person's banner for the rest of the session.
      if (connectingTargetId.current === targetId) connectingTargetId.current = null;
    });
  }, [current, advance, eventId]);

  /** Refresh both collections. Cheap, and only when that surface is opened. */
  const refreshCollections = useCallback(async () => {
    const [clickedPeople, pending] = await Promise.all([
      loadClickedPeopleAction(),
      loadPendingClicksAction()
    ]);
    setClicked(clickedPeople);
    setPendingClicks(pending);
    return { clickedPeople, pending };
  }, []);

  /**
   * Open one mutual person, resolving what that means RIGHT NOW.
   *
   * A conversation that has already started wins over the mutual screen, so
   * revisiting an old match does not offer to start what was started.
   */
  const openMutualPerson = useCallback(
    (connectionId: string, knownPerson?: ClickedPerson) => {
      void (async () => {
        const resolved = await resolveMutualDestinationAction(connectionId);
        if (resolved.kind === "conversation") {
          router.push(`/messages?conversation=${resolved.conversationId}` as Route);
          return;
        }
        if (resolved.kind === "unavailable") {
          // Fails closed and says nothing about the other person: a block they
          // placed is not ours to report.
          setNotice("That's no longer available.");
          setMutualBanner(null);
          void refreshCollections();
          return;
        }
        const person = knownPerson ?? clicked.find((entry) => entry.connectionId === connectionId);
        setMutualBanner(null);
        setMatch({
          displayName: person?.displayName ?? "Someone",
          photo: person?.photo ?? null,
          conversationId: resolved.conversationId ?? undefined,
          hasConversation: false
        });
      })();
    },
    [clicked, refreshCollections, router]
  );

  /**
   * A mutual-connection notification brought us here. Resolve it once, on
   * mount, then let the normal surfaces take over.
   */
  useEffect(() => {
    if (!requestedConnectionId) return;
    void (async () => {
      const { clickedPeople } = await refreshCollections();
      openMutualPerson(
        requestedConnectionId,
        clickedPeople.find((entry) => entry.connectionId === requestedConnectionId)
      );
    })();
    // Intentionally keyed only on the id: re-resolving on every render would
    // reopen the screen the person just dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConnectionId]);

  /**
   * Live reciprocity for the person who chose first.
   *
   * Delivery stays in the app-wide notification subscription. This component
   * only owns how that already-authorised signal is presented while Linkr is
   * active. The connection is resolved again before any UI is shown, so a
   * forged event, stale notification, or newly blocked pair fails closed.
   */
  useEffect(() => {
    const onMutual = (event: Event) => {
      const connectionId = (event as CustomEvent<{ connectionId?: string }>).detail?.connectionId;
      if (!connectionId || connectionId === completedConnectionId.current) return;

      void (async () => {
        const resolved = await resolveMutualDestinationAction(connectionId);
        if (resolved.kind === "unavailable" || resolved.kind === "conversation") return;

        const { clickedPeople } = await refreshCollections();
        const person = clickedPeople.find((entry) => entry.connectionId === connectionId);
        if (!person || connectionId === completedConnectionId.current) return;
        // The match this tab is completing right now: the full mutual screen
        // is already on its way, so a banner behind it would be the same news
        // twice.
        if (person.userId === connectingTargetId.current) return;
        setMutualBanner({ name: person.displayName, connectionId });
      })();
    };

    window.addEventListener("mad-buddy:linkr-mutual", onMutual);
    return () => window.removeEventListener("mad-buddy:linkr-mutual", onMutual);
  }, [refreshCollections]);

  /**
   * Page-level Back.
   *
   * History first, which is what makes Linkr return to wherever it was opened
   * from -- Home, Messages, a notification -- rather than to one hardcoded
   * place that is only correct for one of them. A cold entry has nothing
   * behind it, so it falls back to Home instead of leaving the app.
   */
  const [enteredFromInsideApp] = useState(() => cameFromInsideApp());
  const goBack = useCallback(() => {
    if (enteredFromInsideApp) router.back();
    else router.push("/dashboard" as Route);
  }, [enteredFromInsideApp, router]);

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

  if (view === "preview" && profile) {
    return (
      <LinkrPreview
        profile={profile}
        onBack={() => setView("profile")}
        onEditProfile={goToProfile}
      />
    );
  }

  if (view === "profile") {
    return (
      <LinkrProfileEditor
        profile={profile}
        busy={pending || writing}
        onBack={() => setView("discover")}
        /* OPENS THE PREVIEW. This used to be
           `setNotice("...what other people see on the left")`, set from inside
           this very view -- which returns early, before the notice element
           renders -- so the tap displayed nothing, and described a left-hand
           pane that does not exist on a phone. */
        onPreview={() => setView("preview")}
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

  if (view === "clicked") {
    return (
      <LinkrCollections
        clicked={clicked}
        pending={pendingClicks}
        onOpenPerson={(person) => openMutualPerson(person.connectionId)}
        onBack={() => setView("discover")}
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
        {/* Linkr had no way out but the bottom nav. This is the page-level
            Back, and it only exists on the Discover root: every inner view
            (filters, profile, settings, Clicked) returns earlier with its own
            `linkr-back`, so an internal state always dismisses first.

            Reuses `.linkr-back` -- the same 44px control those inner views
            already use -- so it matches the surface rather than introducing a
            second back style. */}
        <button
          type="button"
          className="linkr-back"
          onClick={goBack}
          aria-label="Back"
        >
          <ArrowLeft aria-hidden />
        </button>
        <h1 className="linkr-topbar__title">Linkr</h1>
        {/* TWO CONTROLS, NOT FOUR.
            The bar carried Back plus four icon buttons -- Clicked, profile,
            filters, settings -- four ambiguous glyphs competing at the top of a
            surface whose entire job is to show one person's face. Every
            destination was real, so nothing is removed: the rarely-used three
            move behind one named menu, and Clicked stays out because it is the
            one people reach for repeatedly (it is where their mutuals live).

            Back stays separate, as its own affordance. */}
        <div className="linkr-topbar__actions">
          {/* Clicked: where mutual people live once they leave the deck. */}
          <button
            type="button"
            onClick={() => {
              setView("clicked");
              void refreshCollections();
            }}
            aria-label={LINKR_COPY.clickedTitle}
          >
            <Hand aria-hidden />
          </button>
          <AppMenu
            label="Linkr controls"
            align="end"
            trigger={
              <button type="button" aria-label="Linkr controls">
                <MoreHorizontal aria-hidden />
              </button>
            }
            items={[
              {
                id: "preview",
                label: "Preview my Linkr card",
                onSelect: () => setView("preview")
              },
              {
                id: "filters",
                label: "Discovery preferences",
                onSelect: () => setView("filters")
              },
              {
                id: "profile",
                label: "Edit Linkr profile",
                onSelect: () => setView("profile")
              },
              {
                id: "settings",
                label: "Linkr settings",
                separatorBefore: true,
                onSelect: () => setView("settings")
              }
            ]}
          />
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
          hasConversation={Boolean(match.hasConversation)}
        />
      ) : null}

      {/* The first connector's signal. Rendered outside the card so it can
          never intercept a decision gesture in flight. */}
      {mutualBanner && !match ? (
        <LinkrMutualBanner
          name={mutualBanner.name}
          onOpen={() => openMutualPerson(mutualBanner.connectionId)}
          onDismiss={() => setMutualBanner(null)}
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
