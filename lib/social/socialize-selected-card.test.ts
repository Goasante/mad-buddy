import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("components/socialize/socialize-page.tsx");
const service = read("lib/social/socialize-mobile.ts");
const css = read("app/globals.css");
const cardCss = stripComments(
  css.slice(
    css.indexOf("/* Socialize selected-person card"),
    // Bounded: the ambient-depth block follows and has its own (looping)
    // drift, which is not this card's to police.
    css.indexOf("/* Socialize ambient depth")
  )
);

/** The selected-person card only. */
const card = page.slice(
  page.indexOf("Selected person — a compact bottom sheet"),
  // Bounded at the report modal that follows. Matched on a single line: the
  // source uses CRLF, so a multi-line needle never matches.
  page.indexOf("open={reportOpen}")
);

// ---------------------------------------------------------------------------
// Relationship model
// ---------------------------------------------------------------------------

describe("relationship model", () => {
  it("only ever shows non-Muddies, because discovery excludes friends", () => {
    // The single most important fact about this card: a Muddy branch would be
    // unreachable, since eligibility filters existing friends out entirely.
    expect(service).toContain(
      "const eligibleIds = candidateIds.filter((id) => !blockedIds.has(id) && !friendIds.has(id));"
    );
  });

  it("presents one relationship state rather than branching on a field that does not exist", () => {
    // SocializePerson carries no relationship field, so the card must not
    // pretend to read one.
    const projection = service.slice(service.indexOf("export type SocializePerson"), service.indexOf("export type SocializeActionResult"));
    expect(projection).not.toContain("relationship");
    expect(stripComments(card)).not.toContain("isMuddy");
    expect(stripComments(card)).not.toContain("isFriend");
  });

  it("never offers Message, which Socialize does not authorise here", () => {
    // Messaging a non-Muddy is not a supported action.
    expect(stripComments(card)).not.toContain("Message");
    expect(stripComments(card)).not.toContain("/messages");
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("identity", () => {
  it("shows avatar, name, username and the premium ring", () => {
    expect(card).toContain("<UserAvatar");
    expect(card).toContain("capitalize(previewPerson.displayName || previewPerson.username)");
    expect(card).toContain("@{previewPerson.username}");
    expect(card).toContain("<PremiumPlanBadge plan={previewPerson.plan} compact />");
  });

  it("keeps the premium ring independent of proximity", () => {
    // Plan drives the badge; the tier only drives the avatar ring colour.
    expect(card).toContain("plan={previewPerson.plan}");
    expect(card).not.toContain("plan={previewPerson.proximityTier}");
  });

  it("shows availability from the person's stated activity", () => {
    expect(card).toContain("SOCIALIZE_ACTIVITY_LABELS[previewPerson.activity]");
  });

  it("truncates long names and usernames rather than overflowing", () => {
    expect(card).toContain("truncate text-[1.0625rem] font-semibold");
    expect(card).toContain("truncate text-[0.8125rem] text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("shows a proximity BAND and never a distance", () => {
    expect(card).toContain("proximityLabels[previewPerson.proximityTier]");
    const block = stripComments(card);
    for (const banned of ["metres", "meters", " km", "miles", "away", "latitude", "longitude", "coordinates"]) {
      expect(block, `card must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("exposes no moderation, billing or private status", () => {
    const block = stripComments(card);
    for (const banned of ["moderation", "billing", "stripe", "confidence", "blockedIds", "reportCount"]) {
      expect(block, `card must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("says nothing about WHY a person vanished", () => {
    expect(page).toContain('showToast("This person is no longer available.");');
    const notice = page.slice(page.indexOf("staleNoticeShownFor"), page.indexOf("This person is no longer available.") + 60);
    for (const banned of ["blocked", "expired", "unauthorised", "out of range"]) {
      expect(notice.toLowerCase(), `must not reveal ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Action hierarchy
// ---------------------------------------------------------------------------

describe("action hierarchy", () => {
  it("makes Wave the one prominent primary action", () => {
    // A single full-width primary Button. Matched as tokens: the source wraps
    // these across lines.
    expect(card).toContain('className="mt-4 min-h-[44px] w-full"');
    expect(card).toContain("onClick={() => wave(previewPerson)}");
    // Exactly one <Button> in the card — the secondary actions are a link and
    // an overflow trigger, so Wave cannot be visually rivalled.
    expect((card.match(/<Button\b/g) ?? []).length).toBe(1);
  });

  it("routes Wave through the existing friend-request action", () => {
    // "Wave" IS Add Muddy: it sends the canonical friend request.
    expect(page).toContain('sendFriendRequestAction(person.userId, "socialize")');
  });

  it("reflects the wave state rather than offering a duplicate send", () => {
    expect(card).toContain('previewPerson.waveState === "sent"');
    expect(card).toContain("disabled={isPending || previewPerson.waveState === \"sent\"}");
    expect(card).toContain('"Accept & connect"');
  });

  it("offers View profile as a secondary action on the existing route", () => {
    expect(card).toContain("`/friends/${previewPerson.username}`");
  });

  it("puts Report and Block behind an overflow, not level with Wave", () => {
    expect(card).toContain("<AppMenu");
    expect(card).toContain('label="Safety options"');
    expect(card).toContain('id: "report"');
    expect(card).toContain('id: "block"');
    expect(card).toContain("destructive: true");
  });

  it("keeps the existing report and block flows", () => {
    expect(card).toContain("setReportOpen(true)");
    expect(card).toContain("blockPerson(previewPerson)");
  });
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

describe("presentation", () => {
  it("is a bottom-anchored sheet, not a full-screen modal", () => {
    expect(card).toContain("absolute bottom-0 left-1/2 w-full max-w-[440px]");
    expect(card).toContain("rounded-t-[1.75rem]");
  });

  it("leaves the radar visible above it", () => {
    // A compact sheet with a translucent backdrop, not an opaque page.
    expect(card).toContain("bg-black/50");
    expect(card).not.toContain("inset-0 bg-background");
  });

  it("carries a drag handle consistent with the app's other sheets", () => {
    expect(card).toContain("h-1 w-9 rounded-full bg-white/20");
  });

  it("clears the bottom navigation and the safe area", () => {
    expect(card).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });
});

// ---------------------------------------------------------------------------
// Selection and dismissal
// ---------------------------------------------------------------------------

describe("selection", () => {
  it("opens on tapping a node", () => {
    expect(page).toContain("setPreviewPerson(person);");
  });

  it("updates in place when another node is selected", () => {
    // The sheet stays mounted; only the keyed content crossfades.
    expect(card).toContain("key={previewPerson.userId}");
    expect(card).toContain("socialize-card-content");
  });

  it("does not re-layout the radar", () => {
    // The layout memo does not depend on the selection.
    // Step 6.1 filters by presence freshness before layout, so the memo now
    // depends on visiblePeople. Still never on the selection.
    expect(page).toContain("[isActive, visiblePeople, rx, ry, geometry.node, geometry.minGap, geometry.maxNodes, centreClearance]");
  });

  it("gives the selected node restrained emphasis only", () => {
    expect(page).toContain('selected && "is-selected"');
  });
});

describe("dismissal", () => {
  it("closes on the backdrop, Escape and Back", () => {
    expect(card).toContain("onClick={clearSelection}");
    expect(page).toContain('if (event.key === "Escape") clearSelection();');
    expect(page).toContain("useDismissOnBack(previewPerson !== null, clearSelection)");
  });

  it("clears the selection and its emphasis", () => {
    expect(page).toContain("setPreviewPerson(null);");
  });

  it("returns focus to the node that opened it", () => {
    expect(page).toContain("selectionOriginRef.current = event.currentTarget;");
    expect(page).toContain("selectionOriginRef.current?.focus?.();");
  });

  it("never navigates away from Socialize", () => {
    const clear = page.slice(page.indexOf("const clearSelection = useCallback"), page.indexOf("useDismissOnBack(previewPerson"));
    expect(clear).not.toContain("router.push");
    expect(clear).not.toContain("router.back");
  });
});

// ---------------------------------------------------------------------------
// Stale selection
// ---------------------------------------------------------------------------

describe("stale selection", () => {
  it("refuses to render a person who is no longer in the authorised feed", () => {
    expect(page).toContain("{previewPerson && selectedStillVisible ? (");
    // Presence-filtered: someone who ages out is also "no longer in the feed".
    expect(page).toContain(
      "visiblePeople.some((candidate) => candidate.userId === previewPerson.userId)"
    );
  });

  it("closes safely and says one neutral thing", () => {
    expect(page).toContain('showToast("This person is no longer available.");');
  });

  it("says it once per person rather than repeatedly", () => {
    expect(page).toContain("staleNoticeShownFor");
  });
});

// ---------------------------------------------------------------------------
// Motion and accessibility
// ---------------------------------------------------------------------------

describe("motion", () => {
  it("slides up softly with no bounce or overshoot", () => {
    expect(cardCss).toContain("@keyframes socialize-card-in");
    expect(cardCss).toContain("cubic-bezier(0.2, 0, 0, 1)");
    expect(cardCss).not.toContain("bounce");
  });

  it("crossfades content when the selection changes", () => {
    expect(cardCss).toContain("@keyframes socialize-card-content-in");
  });

  it("runs no continuous animation", () => {
    expect(cardCss).not.toContain("infinite");
    expect(cardCss).not.toContain("rotate(");
  });

  it("respects reduced motion", () => {
    const reduced = cardCss.slice(cardCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
  });
});

describe("accessibility", () => {
  it("uses dialog semantics labelled by the person's name", () => {
    expect(card).toContain('role="dialog"');
    expect(card).toContain('aria-modal="true"');
    expect(card).toContain('aria-labelledby="socialize-selected-name"');
    expect(card).toContain('id="socialize-selected-name"');
  });

  it("uses a real heading for the name", () => {
    expect(card).toContain("<h2");
  });

  it("keeps every action at a 44px touch target", () => {
    expect((card.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(card).toContain("h-[44px] w-[44px]");
  });

  it("labels the overflow trigger", () => {
    expect(card).toContain('aria-label="More options"');
  });

  it("keeps a visible keyboard focus ring on every action", () => {
    // The link and the overflow trigger carry focus-ring directly; the
    // primary <Button> gets it from its own base class.
    expect((card.match(/focus-ring/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(read("components/ui/button.tsx")).toContain("focus-ring");
  });
});
