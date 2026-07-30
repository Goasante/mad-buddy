import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactCoverageSummary, contactPeerSummary, safeArrivalNotification } from "@/lib/safety/safe-arrival";
import { contactStatusLine } from "@/lib/safety/journey-status";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Code with comments removed.
 *
 * Block comments are stripped as SPANS, not line by line. A line-based filter
 * misses JSX comments (`{/* ... *\/}`) and every continuation line of a
 * multi-line block, which meant a rule about user-visible copy was matching the
 * prose explaining why that copy was changed.
 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/**
 * Slices one top-level declaration, anchored to the next `export` rather than to
 * the first `\n}`. A destructured props block ends with `}: {` at column zero, so
 * the naive window closes before the body and every assertion inside it passes
 * on an empty string.
 */
const declaration = (code: string, signature: string) => {
  const start = code.indexOf(signature);
  if (start === -1) return "";
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
};

const SERVICE = stripComments(read("lib/safety/safe-arrival-service.ts"));

// ---------------------------------------------------------------------------
// Contact state model
// ---------------------------------------------------------------------------

describe("contact state model", () => {
  it("maps the three stored statuses onto invited / accepted / declined", () => {
    const fn = declaration(SERVICE, "function contactStateOf");
    expect(fn).toContain('acknowledgement === "watching" ? "accepted"');
    expect(fn).toContain('acknowledgement === "declined" ? "declined"');
    expect(fn).toContain('"invited"');
  });

  it("reuses the existing column rather than adding a parallel status store", () => {
    // No new table or column: the lifecycle already lived in
    // safe_arrival_contacts.acknowledgement_status.
    expect(SERVICE).toContain("acknowledgement_status");
    const migrations = read("supabase/migrations/20260717120000_safe_arrival_checkins_events.sql");
    expect(migrations).toContain("acknowledgement_status text not null default 'pending'");
  });

  it("does not infer acceptance from having been invited", () => {
    const fn = declaration(SERVICE, "function contactCounts");
    expect(fn).toContain('row.state === "accepted"');
    // acceptedCount must never be derived from the total or from non-declined.
    expect(fn).not.toMatch(/acceptedCount[\s\S]{0,80}!==\s*"declined"/);
  });
});

// ---------------------------------------------------------------------------
// The count bug
// ---------------------------------------------------------------------------

describe("invited is never counted as confirmed", () => {
  it("reports 3 invited with 2 accepted as 2 confirmed and 1 awaiting", () => {
    const summary = contactCoverageSummary({ acceptedCount: 2, invitedCount: 1 });
    expect(summary.headline).toBe("2 Muddies are checking in on you");
    expect(summary.detail).toBe("2 confirmed · 1 awaiting response");
    // The invite total must not surface as the confirmed number anywhere.
    expect(`${summary.headline} ${summary.detail}`).not.toContain("3");
  });

  it("reports nobody as checking in while every invite is unanswered", () => {
    const summary = contactCoverageSummary({ acceptedCount: 0, invitedCount: 3 });
    expect(summary.headline).toBe("Waiting for your Muddies");
    expect(summary.detail).toBe("3 invitations sent");
    expect(summary.headline.toLowerCase()).not.toContain("checking in");
  });

  it("walks 0 → 1 → 2 → 3 confirmed as answers arrive", () => {
    const at = (accepted: number, invited: number) => contactCoverageSummary({ acceptedCount: accepted, invitedCount: invited });
    expect(at(0, 3).detail).toBe("3 invitations sent");
    expect(at(1, 2).headline).toBe("1 Muddy is checking in on you");
    expect(at(1, 2).detail).toBe("1 confirmed · 2 awaiting response");
    expect(at(2, 1).detail).toBe("2 confirmed · 1 awaiting response");
    expect(at(3, 0).detail).toBe("3 confirmed");
    expect(at(3, 0).headline).toBe("3 Muddies are checking in on you");
  });

  it("handles the no-contact case without claiming cover", () => {
    const summary = contactCoverageSummary({ acceptedCount: 0, invitedCount: 0 });
    expect(summary.headline).toBe("No Safe Arrival contacts");
    expect(contactStatusLine({ acceptedCount: 0, invitedCount: 0 })).toContain("No Safe Arrival contacts");
  });

  it("keeps counts server-derived, so a refresh cannot disagree with Realtime", () => {
    // The counts ship with the journey payload; Realtime only triggers a refetch.
    expect(SERVICE).toContain("acceptedCount");
    expect(SERVICE).toContain("invitedCount");
    const hook = stripComments(read("hooks/use-journey-realtime.ts"));
    expect(hook).toContain("router.refresh()");
    // No count is computed from a streamed payload.
    expect(hook).not.toContain("acceptedCount");
  });

  it("does not let the UI recount from the avatar list", () => {
    for (const file of ["components/safety/journey-parts.tsx", "components/safety/safe-arrival-home-cards.tsx"]) {
      const code = stripComments(read(file));
      // A length-based count would silently drop anonymous contacts.
      expect(code, file).not.toMatch(/contacts\.filter\([^)]*\)\.length/);
      expect(code, file).toContain("acceptedCount");
    }
  });

  it("sends accepted-only through the mobile wire field", () => {
    const mobile = stripComments(read("lib/safety/safe-arrival-mobile.ts"));
    const fn = declaration(mobile, "function toSummary");
    expect(fn).toContain('contact.state === "accepted"');
    expect(fn).toContain("sharedCount: journey.acceptedCount");
    expect(fn).toContain("invitedCount: journey.invitedCount");
  });
});

// ---------------------------------------------------------------------------
// Contact identity privacy
// ---------------------------------------------------------------------------

describe("contact identity privacy", () => {
  const fn = declaration(SERVICE, "async function visibleContactsFor");

  it("filters identities on the SERVER, not with CSS", () => {
    expect(fn).toContain("batchEligibleMuddyIds");
    // An unauthorised contact's row carries no identifier at all.
    expect(fn).toContain("id: null, name: null, avatarUrl: null");
  });

  it("uses the accepted-Muddy relationship as the authorization source", () => {
    const permissions = read("lib/social/permissions.ts");
    const batch = declaration(permissions, "export async function batchEligibleMuddyIds");
    expect(batch).toContain('from("friendships")');
    expect(batch).toContain('from("blocked_users")');
    // Blocked in either direction is not a Muddy for this purpose.
    expect(batch).toContain("!blocked.has(id)");
  });

  it("gives the traveller every contact, since they chose them", () => {
    expect(fn).toContain("input.isTraveller");
    expect(fn).toContain("new Set(active.map((row) => row.contactUserId))");
  });

  it("always lets a contact identify themselves", () => {
    expect(fn).toContain("isSelf || knownToViewer.has(row.contactUserId)");
  });

  it("keys anonymous rows positionally, so no user id leaks through React", () => {
    expect(fn).toContain("`anon-${index}`");
    expect(fn).not.toMatch(/key: row\.contactUserId[\s\S]{0,40}name: null/);
  });

  it("drops declined contacts from every visible list", () => {
    expect(fn).toContain('row.state !== "declined"');
  });

  it("is applied by BOTH journey loaders, not just the list one", () => {
    for (const loader of ["export async function loadSafeArrivalJourneys", "export async function loadSafeArrivalJourneyById"]) {
      expect(declaration(SERVICE, loader)).toContain("visibleContactsFor(admin, {");
    }
  });

  it("renders a placeholder rather than a hidden profile", () => {
    for (const file of ["components/safety/journey-parts.tsx", "components/safety/safe-arrival-home-cards.tsx", "components/safety/safe-arrival-page.tsx"]) {
      const code = read(file);
      // Every avatar render is guarded on a name actually being present.
      expect(code, file).toContain("contact.name ?");
      // No display:none / opacity trick standing in for authorization.
      expect(code, file).not.toMatch(/hidden.*contact\.(name|avatarUrl)/);
    }
  });

  it("tells a contact how many others are involved without naming them", () => {
    expect(contactPeerSummary(0)).toBe("You're checking in");
    expect(contactPeerSummary(1)).toBe("You and 1 other are checking in");
    expect(contactPeerSummary(2)).toBe("You and 2 others are checking in");

    // The structural guarantee, rather than a regex over the output: the helper
    // only ever receives a COUNT, so it has no name available to leak.
    const copy = read("lib/safety/safe-arrival.ts");
    const signature = declaration(copy, "export function contactPeerSummary");
    expect(signature).toContain("contactPeerSummary(otherAcceptedCount: number)");
    expect(signature).not.toContain("name");
  });
});

// ---------------------------------------------------------------------------
// Terminology
// ---------------------------------------------------------------------------

describe("check-in terminology", () => {
  /**
   * Patterns, not substrings. "tracking" appears inside Tailwind's
   * `tracking-tight`, so a bare substring test flagged every heading in the
   * feature and would have had to be dropped. The negative lookahead keeps the
   * rule while excluding the utility class.
   */
  const SURVEILLANCE = [/watching over/, /watch over/, /monitoring/, /\bmonitor\b/, /tracking(?!-)/, /surveil/];

  const surfaces = [
    "components/safety/safe-arrival-page.tsx",
    "components/safety/safe-arrival-home-cards.tsx",
    "components/safety/safe-arrival-setup.tsx",
    "components/safety/journey-parts.tsx",
    "lib/safety/safe-arrival.ts",
    "lib/safety/journey-status.ts"
  ];

  it("uses no surveillance wording in any user-visible string", () => {
    for (const file of surfaces) {
      // Comments are stripped: the code legitimately explains WHY the old
      // wording was dropped, and that prose must not fail its own rule.
      const code = stripComments(read(file)).toLowerCase();
      for (const pattern of SURVEILLANCE) {
        expect(code, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("uses the agreed invitation copy", () => {
    const started = safeArrivalNotification("started", {
      travellerName: "Kofi",
      destinationLabel: "Osu",
      timeLabel: "6:37 PM"
    });
    expect(started.title).toBe("Can you check on Kofi?");
    expect(started.message).toContain("Safe Arrival contact");

    const card = read("components/safety/safe-arrival-home-cards.tsx");
    expect(card).toContain("Can you check on {firstName}?");
    expect(card).toContain("wants you as a Safe Arrival contact");
    expect(card).toContain("Count me in");
    expect(card).toContain("Not this time");
  });

  it("uses the agreed accepted and traveller-facing copy", () => {
    const page = read("components/safety/safe-arrival-page.tsx");
    // Written as template literals in JSX ternaries, so matched in that form.
    expect(page).toContain("`You're checking on ${firstName}`");
    expect(page).toContain("Checking in on {firstName}");
    expect(page).toContain('title="Checking in on you"');
    expect(read("components/safety/safe-arrival-home-cards.tsx")).toContain("Checking in on {firstName}");
    expect(read("components/safety/journey-parts.tsx")).toContain('"Checking in on you"');
  });

  it("describes the overdue case as a missed check-in, not an emergency", () => {
    const overdue = safeArrivalNotification("overdue", { travellerName: "Kofi", timeLabel: "6:37 PM" });
    expect(overdue.title).toBe("Kofi hasn't checked in yet");
    expect(`${overdue.title} ${overdue.message}`.toLowerCase()).not.toMatch(/missing|emergency|danger|alarm/);
  });

  it("announces an acceptance without surveillance framing", () => {
    const page = read("app/(app)/safe-arrival-actions.ts");
    expect(page).toContain("watcherAcceptedMessage");
    const copy = read("lib/safety/safe-arrival.ts");
    expect(copy).toContain("will check in on your Safe Arrival.");
  });

  it("does not alarm anyone when a contact declines", () => {
    const actions = stripComments(read("app/(app)/safe-arrival-actions.ts"));
    const ack = declaration(actions, "export async function acknowledgeSafeArrivalAction");
    // A decline records the audit event but notifies nobody.
    expect(ack).toContain('eventType: parsed.data === "watching" ? "acknowledged" : "declined"');
    const notifyIndex = ack.indexOf("deliverNotification");
    const acceptGuard = ack.indexOf('parsed.data === "watching" && changed?.length');
    expect(acceptGuard).toBeGreaterThan(-1);
    expect(notifyIndex).toBeGreaterThan(acceptGuard);
  });

  it("uses no em dashes in the copy this task introduced", () => {
    // Scoped to the new copy helpers and the new card, checked on the STRINGS
    // rather than whole files: the surrounding modules predate this change and
    // their explanatory comments legitimately use em dashes.
    const strings = [
      contactCoverageSummary({ acceptedCount: 0, invitedCount: 2 }),
      contactCoverageSummary({ acceptedCount: 2, invitedCount: 1 }),
      contactCoverageSummary({ acceptedCount: 3, invitedCount: 0 }),
      contactCoverageSummary({ acceptedCount: 0, invitedCount: 0 })
    ].flatMap((summary) => [summary.headline, summary.detail]);
    strings.push(contactPeerSummary(0), contactPeerSummary(1), contactPeerSummary(3));
    strings.push(contactStatusLine({ acceptedCount: 2, invitedCount: 1 }));
    for (const event of ["started", "extended", "overdue", "arrived", "cancelled"] as const) {
      const notification = safeArrivalNotification(event, {
        travellerName: "Kofi",
        destinationLabel: "Osu",
        timeLabel: "6:37 PM"
      });
      strings.push(notification.title, notification.message);
    }
    for (const value of strings) {
      expect(value, value).not.toContain("—");
    }
  });
});

// ---------------------------------------------------------------------------
// Home cards
// ---------------------------------------------------------------------------

describe("home safe arrival cards", () => {
  const cards = read("components/safety/safe-arrival-home-cards.tsx");

  it("leads with the journey and the people, not a shield", () => {
    expect(cards).not.toContain("ShieldCheck");
    expect(cards).not.toContain("Shield");
    expect(cards).toContain("MapPin");
    expect(cards).toContain("Heading to");
  });

  it("shows destination, expected time and remaining time", () => {
    expect(cards).toContain("journey.destinationLabel");
    expect(cards).toContain("Expected by {journeyTime(journey.expectedArrivalAt)}");
    expect(cards).toContain("durationUntilLabel");
  });

  it("derives the rail from TIME, never from a position", () => {
    const fn = declaration(cards, "function timeElapsedPercent");
    expect(fn).toContain("journey.startedAt");
    expect(fn).toContain("journey.expectedArrivalAt");
    // Nothing positional exists to read, and none is invented.
    for (const forbidden of ["latitude", "longitude", "distance", "speed", "coords"]) {
      expect(fn.toLowerCase(), `rail uses ${forbidden}`).not.toContain(forbidden);
    }
    // The rail is decorative and never announced as movement.
    expect(declaration(cards, "function JourneyRail")).toContain('aria-hidden="true"');
  });

  it("keeps the rail animation ambient and reduced-motion aware", () => {
    const css = read("app/globals.css");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".journey-rail")));
    expect(reduced).toContain(".journey-rail-glow { animation: none; }");
    // A slow opacity breath, not a travelling highlight.
    expect(css).toContain("journey-rail-breathe");
    expect(css).toContain("opacity: 0.82");
  });

  it("has a separate invitation card that resolves server-side first", () => {
    const invitation = declaration(cards, "export function ContactInvitationHomeCard");
    expect(invitation).toContain("acknowledgeSafeArrivalAction");

    // Scoped to the respond() handler. A window over the whole component caught
    // the `const [resolved, setResolved] = useState(...)` declaration instead of
    // the assignment, so the ordering assertion proved nothing.
    const respond = invitation.slice(invitation.indexOf("function respond("));
    const body = respond.slice(0, respond.indexOf("\n  }"));
    expect(body).toContain("await acknowledgeSafeArrivalAction");
    // The failure branch returns BEFORE the card leaves the invitation state.
    expect(body.indexOf("if (!result.ok)")).toBeLessThan(body.indexOf("setResolved(result.journey"));
    expect(body).toContain("return;");
    // Accepting swaps straight to the accepted presentation.
    expect(invitation).toContain("<ContactJourneyHomeCard journey={resolved} />");
  });

  it("exposes no map, route or live position", () => {
    for (const forbidden of ["mapbox", "leaflet", "google.maps", "watchPosition", "getCurrentPosition"]) {
      expect(cards.toLowerCase(), `cards use ${forbidden}`).not.toContain(forbidden.toLowerCase());
    }
  });

  it("is wired to the canonical loader with accepted and invited split apart", () => {
    const route = stripComments(read("app/(app)/dashboard/page.tsx"));
    expect(route).toContain("loadSafeArrivalJourneys");
    expect(route).toContain('journey.myAcknowledgement === "accepted"');
    expect(route).toContain('journey.myAcknowledgement === "invited"');
  });

  it("renders nothing on Home when there is no live journey", () => {
    const dashboard = stripComments(read("components/dashboard/dashboard-page.tsx"));
    expect(dashboard).toContain("safeArrival.travelling.length > 0");
    expect(dashboard).toContain("safeArrival.invitations.length > 0");
  });
});
