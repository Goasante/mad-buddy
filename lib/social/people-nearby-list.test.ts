import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Socialize 2.0: the radar was replaced by a vertical discovery feed, so the
 * assertions below that pinned radar-specific markup (orbit nodes, the
 * aggregate chip, the selection ring) no longer describe the product. They are
 * removed rather than rewritten to match new markup, because a source
 * assertion that is edited until it passes tests nothing.
 *
 * The BEHAVIOUR they protected is still covered: state resolution in
 * socialize-state.test.ts, and feed ordering/filtering/privacy in
 * discovery-feed.test.ts.
 */
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sheet = read("components/socialize/people-nearby-sheet.tsx");
const page = read("components/socialize/socialize-page.tsx");
const service = read("lib/social/socialize-mobile.ts");
const css = read("app/globals.css");
const rowCss = stripComments(css.slice(css.indexOf("/* Socialize People Nearby rows")));

const row = sheet.slice(sheet.indexOf("function PersonRow"));

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data and ordering
// ---------------------------------------------------------------------------

describe("data handling", () => {
  it("renders the full authorised set, not the capped radar nodes", () => {
    // The radar limits what it DRAWS; the list stays complete.
    // visiblePeople is the full authorised set minus anyone whose presence
    // has expired — still never the capped radar nodes.
    expect(page).toContain("people={visiblePeople}");
    expect(page).not.toContain("people={field.nodes");
  });

  it("runs no query of its own", () => {
    const source = stripComments(sheet);
    for (const banned of ["createSupabase", "fetch(", "Action(", "useEffect(() => {\n    void"]) {
      expect(source, `list must not ${banned}`).not.toContain(banned);
    }
  });

  it("preserves the server's canonical order", () => {
    // Rendered as given — no client sort anywhere in the sheet.
    expect(sheet).toContain("people.map((person) =>");
    const source = stripComments(sheet);
    expect(source).not.toContain(".sort(");
    expect(source).not.toContain(".reverse(");
  });

  it("keeps the canonical ordering on the server", () => {
    // Tier first, then session recency, then name — never premium or score.
    expect(service).toContain("PROXIMITY_RANK[a.proximityTier] - PROXIMITY_RANK[b.proximityTier]");
  });

  it("never ranks by premium, score or anything else", () => {
    const source = stripComments(sheet);
    for (const banned of ["plan ===", "buddyScore", "popularity", "localeCompare"]) {
      expect(source, `list must not rank by ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

describe("row content", () => {
  it("shows identity, proximity and availability", () => {
    expect(row).toContain("<UserAvatar");
    expect(row).toContain("<PremiumPlanBadge plan={person.plan} compact />");
    expect(row).toContain("proximityLabels[person.proximityTier]");
    expect(row).toContain("SOCIALIZE_ACTIVITY_LABELS[person.activity]");
  });

  it("shows a presence indicator", () => {
    expect(row).toContain("rounded-full border-2 border-[#141419] bg-emerald-500");
  });

  it("stays compact — separators, not a card per person", () => {
    expect(sheet).toContain("divide-y divide-white/[0.06]");
    expect(row).not.toContain("rounded-2xl border");
  });

  it("truncates long names, usernames and activity", () => {
    expect(row).toContain("truncate text-[0.9375rem] font-semibold");
    expect(row).toContain('<span className="truncate">Up for {activity}</span>');
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("row actions", () => {
  it("uses only the supported Wave states", () => {
    expect(row).toContain('person.waveState === "sent" ? "Wave sent"');
    expect(row).toContain('person.waveState === "received" ? "Accept & connect"');
  });

  it("maps Wave to the real friend-request action", () => {
    expect(page).toContain('sendFriendRequestAction(person.userId, "socialize")');
    expect(page).toContain("onWave={wave}");
  });

  it("never offers Message to a non-Muddy", () => {
    const source = stripComments(sheet);
    expect(source).not.toContain("Message");
    expect(source).not.toContain("/messages");
  });

  it("does not duplicate the card's secondary actions", () => {
    // View profile, Report and Block live on the selected-person card.
    const source = stripComments(sheet);
    expect(source).not.toContain("View profile");
    expect(source).not.toContain("Report");
    expect(source).not.toContain("Block");
  });

  it("disables Wave once sent", () => {
    expect(row).toContain('disabled={pending || person.waveState === "sent"}');
  });
});

describe("row interaction", () => {
  it("selects the person when the row is tapped", () => {
    expect(row).toContain("onClick={() => onSelect(person)}");
  });

  it("keeps Wave from also selecting the row", () => {
    // The button is a SIBLING of the row button, so a tap cannot bubble into
    // selection; stopPropagation guards any future row-level handler too.
    expect(row).toContain("event.stopPropagation();");
    expect(row).toContain("onWave(person);");
  });

  it("hands off to the existing selected-person card", () => {
    expect(page).toContain("setListOpen(false);");
    expect(page).toContain("setPreviewPerson(person);");
  });

  it("opens no second profile sheet", () => {
    const source = stripComments(sheet);
    expect(source).not.toContain("role=\"dialog\"\n      aria-label={`Connect");
    // The sheet renders rows only; the profile card is the page's.
    expect(source).not.toContain("previewPerson");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("shows a proximity band and never a distance", () => {
    const source = stripComments(sheet);
    for (const banned of ["metres", "meters", " km", "miles", "away", "latitude", "longitude", "coordinates"]) {
      expect(source, `list must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("exposes no billing, moderation or confidence data", () => {
    const source = stripComments(sheet);
    for (const banned of ["billing", "stripe", "moderation", "confidence", "reportCount"]) {
      expect(source, `list must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("renders only fields on the authorised projection", () => {
    const projection = service.slice(
      service.indexOf("export type SocializePerson"),
      service.indexOf("export type SocializeActionResult")
    );
    for (const field of ["displayName", "username", "avatarUrl", "activity", "proximityTier", "waveState", "plan"]) {
      expect(projection, `${field} must exist on the projection`).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe("states", () => {
  it("shows a light empty state, not an illustration card", () => {
    expect(sheet).toContain("No one is nearby right now.");
    expect(sheet).toContain("Keep Linkr on and check again soon.");
    expect(stripComments(sheet)).not.toContain("<Image");
  });

  it("does not imply location is broken when simply nobody is around", () => {
    const empty = sheet.slice(sheet.indexOf("No one is nearby right now."));
    for (const banned of ["permission", "location off", "enable location", "error"]) {
      expect(empty.toLowerCase().slice(0, 400), `empty state must not say ${banned}`).not.toContain(banned);
    }
  });

  it("uses compact skeletons rather than a full-screen spinner", () => {
    expect(sheet).toContain("animate-pulse");
    expect(stripComments(sheet)).not.toContain("fixed inset-0 grid place-items-center");
  });

  it("offers a concise retry and never a raw error", () => {
    expect(sheet).toContain("We couldn&rsquo;t load people nearby.");
    expect(sheet).toContain("Try again");
    const source = stripComments(sheet);
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("JSON.stringify");
  });

  it("distinguishes a failed load from an empty result", () => {
    // Without this the user would be told nobody is nearby when the request
    // actually failed.
    // Step 6 routed this through the canonical state resolver, so the list's
    // error prop now comes from the resolved state rather than a raw flag.
    expect(page).toContain("setDiscoveryFailed(true);");
    expect(page).toContain('error={displayState === "failed"}');
  });
});

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

describe("live updates", () => {
  it("reuses the existing discovery refresh", () => {
    expect(page).toContain("onRetry={refresh}");
    expect(page).toContain("discoverSocializePeopleAction()");
  });

  it("keys rows by identity so updates never duplicate a person", () => {
    expect(sheet).toContain("key={person.userId}");
  });

  it("clears a vanished selection through the existing neutral path", () => {
    expect(page).toContain('showToast("This person is no longer available.");');
  });
});

// ---------------------------------------------------------------------------
// Presentation and motion
// ---------------------------------------------------------------------------

describe("presentation", () => {
  it("is a bottom sheet that leaves the radar visible", () => {
    expect(sheet).toContain("max-h-[62dvh]");
    expect(sheet).toContain("rounded-t-[1.75rem]");
  });

  it("carries a drag handle, title and stated ordering", () => {
    expect(sheet).toContain("h-1 w-9 shrink-0 rounded-full bg-white/20");
    expect(sheet).toContain("People nearby");
    expect(sheet).toContain("Sorted by proximity");
  });

  it("clears the bottom navigation and safe area", () => {
    expect(sheet).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
  });

  it("scrolls the list, not the page behind it", () => {
    expect(sheet).toContain("overflow-y-auto overscroll-contain");
  });
});

describe("motion", () => {
  it("fades arriving rows without bouncing", () => {
    expect(rowCss).toContain("@keyframes socialize-row-in");
    expect(rowCss).not.toContain("bounce");
    expect(rowCss).not.toContain("infinite");
  });

  it("respects reduced motion", () => {
    const reduced = rowCss.slice(rowCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(sheet).toContain("motion-reduce:animate-none");
  });

  it("never animates a premium ring", () => {
    expect(rowCss).not.toContain("ring");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("labels the sheet semantically", () => {
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('aria-labelledby="people-nearby-title"');
    expect(sheet).toContain('id="people-nearby-title"');
  });

  it("summarises each row once, without repeating proximity", () => {
    // The label carries the hedge when presence is uncertain, so the row
    // never announces certainty it does not have.
    expect(row).toContain("aria-label={`${name}, ${hedge ?? proximity}, up for ${activity}. ${waveLabel}.`}");
    // The visible pill is not separately announced.
    expect(row).toContain("proximityLabels[person.proximityTier]");
  });

  it("labels the Wave action with the person it applies to", () => {
    expect(row).toContain("aria-label={`${waveLabel} — ${name}`}");
  });

  it("keeps 44px touch targets on the row and its action", () => {
    expect(row).toContain("min-h-[44px] min-w-0 flex-1");
    expect(row).toContain('className="min-h-[44px] shrink-0"');
  });

  it("closes on Escape and Back, and restores focus", () => {
    expect(sheet).toContain('if (event.key === "Escape") onClose();');
    expect(sheet).toContain("useDismissOnBack(open, onClose)");
    expect(sheet).toContain("returnFocusRef.current?.focus?.()");
  });

  it("keeps a visible keyboard focus ring", () => {
    expect((sheet.match(/focus-ring/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
