"use client";

import { ArrowLeft, BookUser, Loader2, Phone, Search, Share2, UserPlus, Users } from "lucide-react";
import { useCallback, useReducer, useState } from "react";

import { sendFriendRequestAction } from "@/app/(app)/actions";
import { completeContactSetupAction } from "@/app/(app)/contact-actions";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { detectContactCapability, selectContacts } from "@/lib/contacts/contact-capability";
import { DEMO_CONTACTS, demoContactsAvailable } from "@/lib/contacts/demo-contacts";
import {
  findMuddiesReducer,
  INITIAL_STATE,
  mayOpenPicker,
  showsBack,
  type ContactMatchView,
  type FindMuddiesEvent,
  type RetryTarget
} from "@/lib/contacts/find-muddies-machine";
import { haptic } from "@/lib/device/haptics";
import { shareInvite } from "@/lib/device/invite-share";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Find Your Muddies.
 *
 * ONE sheet, driven by an explicit state machine rather than a set of booleans
 * that could contradict each other -- see find-muddies-machine.ts for why, and
 * for the transition table. This file renders those states and nothing more.
 *
 * THE PERMISSION PROMPT NEVER APPEARS ON ITS OWN. Opening this shows the
 * explanation. Tapping "Find my Muddies" checks what the device can do and
 * shows a second screen saying what will happen. Only a further tap on "Choose
 * contacts" reaches the picker. The reducer enforces that ordering: SELECTING
 * is reachable from SUPPORTED_READY alone.
 *
 * NO DEAD ENDS. Every screen offers something that works -- the unsupported
 * screen focuses the real Muddies search or opens the real share sheet, an
 * error offers a retry that returns to the step that failed, and no-results
 * offers both. The previous version's "Search Muddies" was a link to /friends
 * from a sheet already on /friends: Next.js saw the same route, did nothing,
 * and the sheet closed. That is the bug this rewrite exists for.
 */

type MatchPayload = {
  matches?: ContactMatchView[];
};

export function FindMuddiesSheet({
  open,
  onClose,
  onSearchMuddies
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Closes the sheet and focuses the Muddies search field.
   *
   * Passed in rather than routed to, because the canonical search already
   * exists on the page underneath -- navigating to it would be a no-op, which
   * is precisely how the dead button happened.
   */
  onSearchMuddies?: () => void;
}) {
  const [state, dispatch] = useReducer(findMuddiesReducer, INITIAL_STATE);
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [notice, setNotice] = useState("");

  const close = useCallback(() => {
    dispatch({ type: "open" });
    setRequested({});
    setRowError("");
    setNotice("");
    onClose();
  }, [onClose]);

  /**
   * Submits numbers and moves to results.
   *
   * Takes the numbers rather than reading them, so the demo fixture and the OS
   * picker converge here and every state after selection is identical on both
   * paths. There is no branch below this point.
   */
  const runMatch = useCallback(async (phoneNumbers: string[]) => {
    dispatch({ type: "selected" });

    const fail = (message: string, retry: RetryTarget) => dispatch({ type: "failed", message, retry });

    // Sent RAW. The server normalises and derives identifiers; a client that
    // normalised first would be deciding what matches.
    const response = await fetch("/api/contacts/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumbers })
    }).catch(() => null);

    if (!response) {
      fail("Couldn't check your contacts. Check your connection and try again.", "match");
      return;
    }

    if (!response.ok) {
      // Ordinary words. Why the floor exists -- stopping anyone testing one
      // number at a time -- is an implementation detail and stays internal.
      if (response.status === 400) {
        fail("Choose a few more contacts so Mad Buddy can check them privately.", "choose");
      } else if (response.status === 429) {
        // Another tap cannot help today, so no retry is offered.
        fail("You've checked your contacts a few times today. Try again tomorrow.", null);
      } else {
        fail("Couldn't check your contacts.", "match");
      }
      return;
    }

    const payload = (await response.json().catch(() => null)) as MatchPayload | null;
    dispatch({ type: "matched", matches: payload?.matches ?? [] });

    // Setup is complete once contacts have actually been checked -- not when a
    // number was saved. Someone may add a number and never come near their
    // contacts, and the reminder exists for exactly that gap. Reaching a
    // result closes it, whether or not anyone matched.
    void completeContactSetupAction();
  }, []);

  /** "Find my Muddies" on the explanation screen. Touches no contacts. */
  function begin() {
    haptic("tick");
    const capability = detectContactCapability();
    const supported =
      capability === "picker" || capability === "native" || demoContactsAvailable();
    dispatch({ type: "begin", supported });
  }

  /** "Choose contacts". The ONLY path to the OS picker. */
  async function choose() {
    const event: FindMuddiesEvent = { type: "choose" };
    // Belt and braces beside the reducer: an edit that wired this to the wrong
    // handler should fail a test, not ship a permission prompt.
    if (!mayOpenPicker(state, event)) return;

    haptic("tick");

    if (detectContactCapability() === "unsupported" && demoContactsAvailable()) {
      // Development only, and compiled out of production builds. Stands in for
      // the device picker so the supported UI can be reviewed on a desktop;
      // the numbers are fake and the server still applies every rule.
      dispatch(event);
      await runMatch(DEMO_CONTACTS.map((contact) => contact.phoneNumber));
      return;
    }

    dispatch(event);
    const selection = await selectContacts();

    if (!selection.ok) {
      if (selection.reason === "cancelled") {
        // Closing the picker is a normal choice: back to the screen that
        // opened it, silently, and with no second prompt.
        dispatch({ type: "cancelled" });
        return;
      }
      if (selection.reason === "unsupported") {
        dispatch({ type: "failed", message: "Couldn't open your contacts.", retry: null });
        return;
      }
      dispatch({ type: "failed", message: "Couldn't read your contacts.", retry: "choose" });
      return;
    }

    await runMatch(selection.phoneNumbers);
  }

  function addMuddy(person: ContactMatchView) {
    setRowError("");
    setPendingAdd(person.userId);
    void (async () => {
      // The canonical friend-request action, the same one search and profiles
      // use. No contacts-specific relationship exists.
      const result = await sendFriendRequestAction(person.userId);
      setPendingAdd(null);
      if (result.ok) {
        haptic("select");
        setRequested((current) => ({ ...current, [person.userId]: true }));
      } else {
        // Reported beside the list rather than replacing it: one failed add
        // must not throw away everybody else's row.
        setRowError(result.message);
      }
    })();
  }

  function searchMuddies() {
    haptic("tick");
    // Closes the sheet AND focuses the search field underneath. Both, in that
    // order -- the field cannot take focus while a modal holds it.
    close();
    onSearchMuddies?.();
  }

  function invite() {
    haptic("tick");
    void (async () => {
      const outcome = await shareInvite();
      // Says what happened. A clipboard fallback that reported nothing was the
      // other half of "tapping does nothing".
      if (outcome === "copied") setNotice("Invite link copied.");
      else if (outcome === "unavailable") setNotice("Couldn't open sharing on this device.");
    })();
  }

  const bottomActions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button type="button" className="w-full sm:w-auto" onClick={searchMuddies}>
        <Search className="h-4 w-4" aria-hidden="true" />
        Search Muddies
      </Button>
      <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={invite}>
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Invite someone
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Find Your Muddies"
      variant="sheet"
    >
      {/* One Back control for every screen that has one, rather than a
          different affordance per state. INTRO is dismissed by the sheet
          itself, which is the gesture people already expect. */}
      {showsBack(state) ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "back" })}
          className="focus-ring -ml-2 mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      ) : null}

      {state.name === "INTRO" ? (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            See which people you already know are on Mad Buddy. Choose contacts to privately check &mdash; they
            won&rsquo;t appear on your profile.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="w-full sm:w-auto" onClick={begin}>
              <Users className="h-4 w-4" aria-hidden="true" />
              Find my Muddies
            </Button>
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={close}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}

      {state.name === "SUPPORTED_READY" ? (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            You&rsquo;ll pick which contacts to check. Mad Buddy only looks at the ones you choose, and nothing is
            saved.
          </p>

          {/* Development only: compiled out of production, and labelled so it
              can never be mistaken for the real picker during review. */}
          {demoContactsAvailable() && detectContactCapability() === "unsupported" ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs leading-5 text-muted-foreground">
              Development build: this device has no contact picker, so {DEMO_CONTACTS.length} sample contacts will be
              used.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="w-full sm:w-auto" onClick={() => void choose()}>
              <BookUser className="h-4 w-4" aria-hidden="true" />
              Choose contacts
            </Button>
          </div>
        </div>
      ) : null}

      {state.name === "SELECTING" || state.name === "MATCHING" ? (
        <div className="flex items-center gap-3 py-8" role="status">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {/* Never "hashing", "normalising" or "matching identifiers". */}
            {state.name === "SELECTING" ? "Waiting for your contacts…" : "Finding your Muddies…"}
          </p>
        </div>
      ) : null}

      {state.name === "UNSUPPORTED" ? (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Contact matching isn&rsquo;t available on this device yet. You can still search for people or invite
            someone to Mad Buddy.
          </p>
          {bottomActions}
        </div>
      ) : null}

      {state.name === "ERROR" ? (
        <div className="space-y-5">
          <p role="alert" className="text-sm font-medium leading-6">
            {state.message}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {state.retry ? (
              <Button type="button" className="w-full sm:w-auto" onClick={() => dispatch({ type: "retry" })}>
                Try again
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={searchMuddies}>
              <Search className="h-4 w-4" aria-hidden="true" />
              Search Muddies
            </Button>
          </div>
        </div>
      ) : null}

      {state.name === "NO_RESULTS" ? (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">No Muddies found yet</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {/* Truthful about why: people appear only if they chose to be
                  findable, which is the same consent this user was asked for. */}
              We couldn&rsquo;t find anyone from your contacts who&rsquo;s findable on Mad Buddy right now.
            </p>
          </div>
          {bottomActions}
        </div>
      ) : null}

      {state.name === "RESULTS" ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">People you may know</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {/* "May know", never "this contact is that account". The server
                  deliberately never says which number produced which match. */}
              {state.matches.length} from your contacts {state.matches.length === 1 ? "is" : "are"} on Mad Buddy.
            </p>
          </div>

          <ul className="divide-y divide-border/60">
            {state.matches.map((person) => {
              const isRequested = requested[person.userId] || person.relationship === "requested";
              return (
                <li key={person.userId} className="flex items-center gap-3 py-3">
                  <UserAvatar
                    src={person.avatarUrl}
                    name={person.displayName}
                    size="sm"
                    decorative
                    membershipTier={publicMembershipTier(person.plan as SubscriptionPlan)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{person.displayName}</p>
                      {/* The canonical marks, resolved server-side. Nothing
                          here is inferred from the match itself. */}
                      <PremiumPlanBadge plan={person.plan as SubscriptionPlan} compact />
                      <VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount} compact />
                      <TrustedMemberMark trustedSince={person.trustedSince} compact />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">@{person.username}</p>
                  </div>

                  {person.relationship === "muddies" ? (
                    <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      Muddies
                    </span>
                  ) : isRequested ? (
                    <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      Requested
                    </span>
                  ) : person.relationship === "incoming" ? (
                    // They asked first. Sending a second request would create a
                    // crossing pair; the Requests tab is where this is answered.
                    <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      Asked you
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={pendingAdd === person.userId}
                      onClick={() => addMuddy(person)}
                      aria-label={`Add ${person.displayName} as a Muddy`}
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add Muddy
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {rowError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {rowError}
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {/* Where the other half of the feature lives, stated on the way out
          rather than left to be discovered. Only on screens that are not
          mid-task, so it never competes with the action in hand. */}
      {state.name === "INTRO" || state.name === "NO_RESULTS" || state.name === "UNSUPPORTED" ? (
        <p className="mt-5 flex items-start gap-2 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Want people who have your number to find you? That&rsquo;s a separate choice in{" "}
            <a className="focus-ring font-medium text-foreground underline" href="/settings/contact-discovery">
              Settings &rsaquo; Privacy &rsaquo; Contact discovery
            </a>
            .
          </span>
        </p>
      ) : null}
    </Modal>
  );
}
