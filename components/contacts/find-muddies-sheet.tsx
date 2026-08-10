"use client";

import { Loader2, Search, Share2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { sendFriendRequestAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { detectContactCapability, selectContacts } from "@/lib/contacts/contact-capability";
import { haptic } from "@/lib/device/haptics";

/**
 * Find Your Muddies.
 *
 * One sheet, four states: an explanation, the contact step, results, and an
 * honest dead end on platforms that cannot do this at all.
 *
 * THE PERMISSION PROMPT NEVER APPEARS ON ITS OWN. Opening this shows the
 * explanation and nothing else -- no capability is invoked until somebody taps
 * "Find my Muddies". That ordering is the whole point of the first screen: a
 * system dialog that arrives unexplained is one people refuse, and refusing it
 * is sticky.
 *
 * NOTHING IS SENT AUTOMATICALLY. Matching returns profiles; adding a Muddy is
 * a separate, deliberate tap on each person. There is no "add all".
 */

type Stage = "explain" | "working" | "results" | "unsupported";

type MatchedPerson = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

/** Mirrors the server floor. Copy stays consumer-facing; the reason does not. */
const MIN_USABLE = 5;

export function FindMuddiesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("explain");
  const [matches, setMatches] = useState<MatchedPerson[]>([]);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage("explain");
    setMatches([]);
    setError("");
    setRequested({});
    onClose();
  }, [onClose]);

  async function findMuddies() {
    haptic("tick");
    setError("");

    const capability = detectContactCapability();
    if (capability === "unsupported" || capability === "unknown") {
      // Honest, not a retry prompt: no browser setting will change this.
      setStage("unsupported");
      return;
    }

    const selection = await selectContacts();

    if (!selection.ok) {
      if (selection.reason === "cancelled") {
        // Closing the picker is a normal choice. Return to the explanation
        // silently -- no error, and above all no second permission prompt.
        return;
      }
      if (selection.reason === "unsupported") {
        setStage("unsupported");
        return;
      }
      setError("Mad Buddy couldn't read your contacts. You can try again, or search for people instead.");
      return;
    }

    setStage("working");

    // Sent RAW to the server, which normalises and derives identifiers. A
    // client that normalised first would be deciding what matches.
    const response = await fetch("/api/contacts/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumbers: selection.phoneNumbers })
    }).catch(() => null);

    if (!response) {
      setError("Couldn't reach Mad Buddy. Check your connection and try again.");
      setStage("explain");
      return;
    }

    if (!response.ok) {
      // A too-small batch is explained in ordinary terms. The reason the floor
      // exists -- preventing anyone from testing one number at a time -- is an
      // implementation detail and stays internal.
      setError(
        response.status === 400
          ? `Choose at least ${MIN_USABLE} contacts with phone numbers so Mad Buddy can match them privately.`
          : response.status === 429
            ? "You've searched your contacts a few times today. Try again tomorrow."
            : "Contact matching isn't available right now. Please try again later."
      );
      setStage("explain");
      return;
    }

    const payload = (await response.json().catch(() => null)) as { matches?: MatchedPerson[] } | null;
    setMatches(payload?.matches ?? []);
    setStage("results");
  }

  function addMuddy(person: MatchedPerson) {
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
        setError(result.message);
      }
    })();
  }

  function shareMadBuddy() {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    const text = "Join me on Mad Buddy";
    // Web Share where available; clipboard otherwise. Never an automatic
    // message, and never anything addressed to a specific contact.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      void navigator.share({ title: "Mad Buddy", text, url }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(`${text} — ${url}`);
    setError("Invite link copied.");
  }

  // "sheet" is bottom-anchored and safe-area aware on phones, and a Back press
  // dismisses it -- which is where this feature is actually used.
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
      }}
      title="Find Your Muddies"
      variant="sheet"
    >
      {stage === "explain" ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            Mad Buddy can privately check your contacts against people who have chosen to be findable. Your contacts
            aren&rsquo;t added to your profile or shown to anyone, and no requests are sent automatically.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void findMuddies()}>
              <Users className="h-4 w-4" aria-hidden="true" />
              Find my Muddies
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Not now
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === "working" ? (
        <div className="flex items-center gap-3 py-6" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Checking your contacts…</p>
        </div>
      ) : null}

      {stage === "unsupported" ? (
        <div className="space-y-4">
          {/* Honest. iOS Safari and installed PWAs have no contact access at
              all, so there is no permission to grant and no setting to change.
              Saying otherwise would send people hunting for something that
              does not exist. */}
          <p className="text-sm leading-6 text-muted-foreground">
            Reading contacts isn&rsquo;t available in this version of Mad Buddy on your device. You can still find
            people by searching, or share Mad Buddy with someone you know.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" asChild>
              <Link href="/friends" onClick={reset}>
                <Search className="h-4 w-4" aria-hidden="true" />
                Search Muddies
              </Link>
            </Button>
            <Button type="button" variant="outline" onClick={shareMadBuddy}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share Mad Buddy
            </Button>
          </div>
        </div>
      ) : null}

      {stage === "results" ? (
        <div className="space-y-4">
          {matches.length === 0 ? (
            <>
              <p className="text-sm leading-6 text-muted-foreground">
                None of your contacts are findable on Mad Buddy right now. People appear here only if they&rsquo;ve
                turned on contact discovery themselves.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={shareMadBuddy}>
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  Share Mad Buddy
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {matches.length} {matches.length === 1 ? "person" : "people"} you may know
              </p>
              <ul className="divide-y divide-border/60">
                {matches.map((person) => (
                  <li key={person.userId} className="flex items-center gap-3 py-3">
                    <UserAvatar src={person.avatarUrl} name={person.displayName} size="sm" decorative />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{person.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">@{person.username}</p>
                    </div>
                    {requested[person.userId] ? (
                      <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                        Requested
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={pendingAdd === person.userId}
                        onClick={() => addMuddy(person)}
                        aria-label={`Add ${person.displayName} as a Muddy`}
                      >
                        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add Muddy
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
