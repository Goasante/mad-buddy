import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { showsQuickActions } from "@/lib/navigation/quick-actions";
import { composeHome, isEarlyActivation } from "@/lib/activation/home-composition";
import { resolveActivationState, type ActivationInputs } from "@/lib/activation/state";

/**
 * The whole journey, not the states in isolation.
 *
 * Each state was right on its own while the path between them sent people into
 * general Settings to work out that turning Ghost Mode OFF is what turns Glow
 * ON. Activation should never require understanding the implementation.
 */

const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

const copyFor = (state: string, next: string) =>
  card.slice(card.indexOf(`${state}: {`), card.indexOf(`${next}: {`));

const base: ActivationInputs = {
  muddyCount: 2,
  pendingOutgoingCount: 0,
  locationGranted: false,
  locationFreshForProximity: false,
  visibility: "ghost",
  nearbyMuddyCount: 0,
  upcomingPlanCount: 0,
  milestones: new Set(["first_muddy_added"])
};
const withInputs = (over: Partial<ActivationInputs>) => ({ ...base, ...over });

describe("one Glow language everywhere", () => {
  const copy = copyFor("muddies_no_location", "location_stale");

  it("names the capability, not the operating system", () => {
    expect(copy).toContain("Turn on Glow");
    expect(copy).not.toContain("Turn on location");
  });

  it("drops the rejected wording", () => {
    for (const rejected of ["See when they're around", "exact spot", "see your area"]) {
      expect(copy).not.toContain(rejected);
    }
  });

  it("uses the approved body sentence", () => {
    expect(copy).toContain("Mad Buddy uses your location privately");
  });

  it("leads with Glow rather than a map pin", () => {
    // The point is that this state does NOT reach for map/location iconography
    // — Glow is a presence idea, not a pin on a map. It used to be spelled
    // `Sparkles`; the icon audit replaced that with RadioTower (presence being
    // broadcast) because sparkles read as "AI magic" rather than proximity.
    // The invariant is the absence of the pin, so that is what is asserted,
    // plus a real icon being chosen at all.
    expect(copy).not.toContain("MapPin");
    expect(copy).not.toContain("Sparkles");
    expect(copy).toContain("RadioTower");
  });

  it("keeps the trust guarantees", () => {
    expect(copy).toMatch(/only approved muddies/i);
    expect(copy).toMatch(/never your exact location/i);
    expect(copy).toMatch(/you stay in control/i);
  });

  it("introduces no radar or GPS vocabulary anywhere", () => {
    for (const banned of ["Radar", "radar", "GPS"]) {
      expect(card).not.toContain(banned);
    }
  });
});

describe("the journey advances without a detour through Settings", () => {
  it("runs the location prompt from Home", () => {
    /* The card used to link to /settings, where somebody had to find "Location
     * for glow" themselves. updatePrivateLocation is the same callback Quick
     * Controls already uses -- one implementation, invoked at the moment the
     * card asks. */
    expect(home).toContain("activationPrimaryAction");
    expect(home).toContain("updatePrivateLocation");
  });

  it("refreshes the server projection after a new fix", () => {
    // Activation state is server-derived; without this Home keeps asking for
    // a location it already has.
    const fix = home.slice(home.indexOf("api/location/update"), home.indexOf("catch {"));
    expect(fix).toContain("router.refresh()");
  });

  it("changes visibility through the canonical mutation", () => {
    expect(home).toContain('updateVisibilityStatusAction("visible")');
    expect(home).toContain('from "@/app/(app)/settings-actions"');
  });

  it("builds no second visibility path", () => {
    // No direct profile write, no re-decided privacy rule.
    expect(home).not.toContain('.from("profiles").update');
    expect(home).not.toContain("visibility_status:");
  });

  it("re-projects Home rather than guessing the next state", () => {
    const enable = home.slice(
      home.indexOf("function enableVisibilityFromActivation"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(enable).toContain("router.refresh()");
  });

  it("keeps a link for states whose action really is another page", () => {
    expect(card).toContain("onPrimaryAction ? (");
    expect(card).toContain("<Link href={copy.href}>");
  });
});

describe("Glow is ready speaks the user's language", () => {
  const copy = copyFor("visibility_off", "location_stale");

  it("asks for visibility, never for Ghost Mode", () => {
    /* "Ghost Mode ON means visibility OFF, so turn it off to turn Glow on" is
     * implementation the product should translate, not homework. */
    expect(copy).toContain("Turn on visibility");
    expect(copy).not.toContain("Ghost");
    expect(copy).not.toContain("Disable");
  });

  it("says the choice is reversible", () => {
    expect(copy).toMatch(/turn it off again|whenever you like/i);
  });
});

describe("the state machine produces the intended sequence", () => {
  it("asks for Glow first", () => {
    expect(resolveActivationState(base)).toBe("muddies_no_location");
  });

  it("moves to the visibility choice once location works", () => {
    const located = withInputs({ locationGranted: true, locationFreshForProximity: true });
    expect(resolveActivationState(located)).toBe("visibility_off");
  });

  it("reaches the success state once visible", () => {
    const on = withInputs({
      locationGranted: true,
      locationFreshForProximity: true,
      visibility: "visible"
    });
    expect(resolveActivationState(on)).toBe("no_one_nearby");
  });

  it("never requires Ghost Mode knowledge to get there", () => {
    expect(card).not.toContain("Ghost Mode");
  });
});

describe("Settings keeps its controls, and loses the floating pill", () => {
  it("hides Quick Actions on Settings and its sub-pages", () => {
    /* A bottom reservation cannot fix a toggle met MID-SCROLL, and a shortcut
     * to five other features earns nothing where somebody is deliberately
     * configuring one thing. */
    expect(showsQuickActions("/settings")).toBe(false);
    expect(showsQuickActions("/settings/glow-visibility")).toBe(false);
  });

  it("leaves the manual privacy controls in place", () => {
    // This changes how activation USES Settings, not whether it exists.
    const settings = readFileSync("components/settings/settings-page.tsx", "utf8");
    expect(settings).toContain("Ghost Mode");
    expect(settings).toContain("updateVisibilityStatusAction");
  });

  it("keeps the launcher on ordinary browsing surfaces", () => {
    expect(showsQuickActions("/dashboard")).toBe(true);
    expect(showsQuickActions("/plans")).toBe(true);
  });
});

describe("configuring Glow is not first value", () => {
  const brandNew = {
    activationState: "no_one_nearby" as const,
    acknowledgingFirstMuddy: false,
    milestones: new Set(["first_muddy_added"]),
    hasSafetyCard: false,
    twoSidedConversationCount: 0,
    planParticipationCount: 0,
    muddyCount: 1,
    nextUnspokenMuddy: null,
    missingProfileItems: [],
    unreadConversationCount: 0,
    upcomingPlanCount: 0
  };

  it("keeps a new user's Home focused after Glow is on", () => {
    expect(isEarlyActivation(brandNew)).toBe(true);
  });

  it("does not bring Complete Profile back the moment visibility flips", () => {
    // Setup is not an arrival, and treating it as one is the product
    // congratulating itself for a settings change.
    expect(composeHome(brandNew).showProfileReminder).toBe(false);
  });

  it("suppresses the generic modules until real value", () => {
    const composed = composeHome(brandNew);
    expect(composed.showTrending).toBe(false);
    expect(composed.showJourneyCard).toBe(false);
    expect(composed.showMoments).toBe(false);
    expect(composed.showSuggestions).toBe(false);
  });

  it("still shows exactly one empty-room surface", () => {
    expect(composeHome(brandNew).showNearby).toBe(false);
  });

  it("opens Home once somebody has actually interacted", () => {
    const arrived = { ...brandNew, milestones: new Set(["first_muddy_added", "first_wave_sent"]) };
    // Activation closes; Home still opens gradually (early_value).
    expect(isEarlyActivation(arrived)).toBe(false);
    expect(composeHome(arrived).showProfileReminder).toBe(false);
  });

  it("keeps real commitments and safety visible throughout", () => {
    const withPlan = { ...brandNew, upcomingPlanCount: 1, hasSafetyCard: true };
    expect(composeHome(withPlan).showPlansEmpty).toBe(false);
    // A real plan renders from its own branch, and safety from its own gate.
    expect(home).toContain("agendaItems.length > 0");
    expect(home).toContain("{hasSafeArrival ?");
  });
});

describe("state decides composition, never copy", () => {
  it("matches no headline text to choose what renders", () => {
    const composition = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));
    for (const copy of ["Glow is on", "Turn on Glow", "Glow is ready", "headline"]) {
      expect(composition).not.toContain(copy);
    }
  });

  it("picks the Home handler from state, not from a label", () => {
    const handler = home.slice(
      home.indexOf("const activationPrimaryAction"),
      home.indexOf("RSVP from the Home plan stack")
    );
    expect(handler).toContain('activationState === "muddies_no_location"');
    expect(handler).not.toContain('"Turn on Glow"');
  });
});
