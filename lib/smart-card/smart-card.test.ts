import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import {
  isWeekendPlanningWindow,
  resolveSmartCard,
  smartCardProgress,
  weekendWindowExpiry,
  SMART_CARD_IDS,
  SMART_CARD_PRIORITY,
  type SmartCardId
} from "@/lib/smart-card/smart-card";
import type { JourneyData, JourneyStep } from "@/lib/journey/journey";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** A Wednesday, deliberately outside the weekend window. */
const WEDNESDAY = new Date(2026, 7, 5, 10, 0, 0);

function step(overrides: Partial<JourneyStep> = {}): JourneyStep {
  return {
    id: "complete_profile",
    title: "Complete Profile",
    description: "Help your Muddies recognise you.",
    state: "current",
    unlockCondition: "Add a photo, bio, and mood.",
    destination: "/profile",
    guide: null,
    ...overrides
  };
}

function journey(completed: number, total = 10): JourneyData {
  return {
    completedCount: completed,
    totalCount: total,
    currentStep: completed >= total ? null : step(),
    steps: []
  };
}

/** Baseline: every provider declines except the guaranteed fallback. */
function input(overrides: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: WEDNESDAY,
    journey: journey(10),
    safeArrival: null,
    birthday: null,
    weekendPlanCount: 0,
    nearbyCount: 0,
    hasPremium: true,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...overrides
  };
}

function resolve(overrides: Partial<SmartCardInput> = {}, acknowledgedIds?: ReadonlySet<string>) {
  const built = input(overrides);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds
  });
}

/**
 * The baseline journey is complete, so `journey_complete` legitimately wins
 * every resolve until it is acknowledged. Tests that target a LOWER-priority
 * card have to get past it — acknowledging it is exactly how a real user
 * would, so these tests exercise the real path rather than a special case.
 */
const PAST_JOURNEY = new Set(["journey_complete"]);

// ---------------------------------------------------------------------------
// The core invariant: exactly one card, always
// ---------------------------------------------------------------------------

describe("smart card — one card, always", () => {
  it("returns a card for a brand-new user with nothing set up", () => {
    const card = resolve({ journey: journey(0), hasPremium: false });
    expect(card).not.toBeNull();
  });

  it("returns a card for a fully-completed user with nothing else applicable", () => {
    // Journey done and acknowledged, premium held, no birthday, midweek.
    const card = resolve({}, new Set(["journey_complete"]));
    expect(card).not.toBeNull();
    expect(card?.id).toBe("suggestions");
  });

  it("never returns more than one card — resolve yields a single object", () => {
    const card = resolve({ journey: journey(3), nearbyCount: 5, hasPremium: false });
    expect(card).not.toBeNull();
    expect(Array.isArray(card)).toBe(false);
  });

  it("the fallback provider never declines, whatever the input", () => {
    const providers = smartCardProviders(input({ suggestionCount: 0 }));
    const fallback = providers.find((provider) => provider.id === "suggestions");
    expect(fallback?.build()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("smart card priority ordering", () => {
  it("orders the canonical ids exactly as the product rule requires", () => {
    expect([...SMART_CARD_IDS]).toEqual([
      "safe_arrival",
      "journey",
      "journey_complete",
      "birthday",
      "weekend_plans",
      "nearby_muddies",
      "membership",
      "buddy_progress",
      "achievement",
      "suggestions"
    ]);
  });

  it("derives priority from the id order so the two cannot drift", () => {
    SMART_CARD_IDS.forEach((id, index) => {
      expect(SMART_CARD_PRIORITY[id]).toBe(index);
    });
  });

  it("Safe Arrival overrides every other card, including the Journey", () => {
    const card = resolve({
      safeArrival: { travelling: true, watcherCount: 2 },
      journey: journey(3),
      birthday: { birthdayToday: true, birthdayTomorrow: false },
      nearbyCount: 9,
      hasPremium: false
    });
    expect(card?.id).toBe("safe_arrival");
  });

  it("an incomplete Journey outranks birthday, weekend, nearby and membership", () => {
    const card = resolve({
      journey: journey(3),
      birthday: { birthdayToday: true, birthdayTomorrow: false },
      nearbyCount: 9,
      hasPremium: false
    });
    expect(card?.id).toBe("journey");
  });

  it("birthday outranks weekend plans, nearby and membership", () => {
    const friday = new Date(2026, 7, 7, 19, 0, 0);
    const card = resolve(
      {
        now: friday,
        birthday: { birthdayToday: true, birthdayTomorrow: false },
        weekendPlanCount: 2,
        nearbyCount: 4,
        hasPremium: false
      },
      PAST_JOURNEY
    );
    expect(card?.id).toBe("birthday");
  });

  it("nearby outranks membership and buddy progress", () => {
    const card = resolve(
      {
        nearbyCount: 3,
        hasPremium: false,
        buddyScore: { nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 }, pointsToNext: 40, progressPercent: 80 }
      },
      PAST_JOURNEY
    );
    expect(card?.id).toBe("nearby_muddies");
  });

  it("registration order cannot change the winner", () => {
    const built = input({ journey: journey(3), nearbyCount: 5, hasPremium: false });
    const reversed = [...smartCardProviders(built)].reverse();
    const card = resolveSmartCard(reversed, { now: built.now.getTime() });
    expect(card?.id).toBe("journey");
  });

  it("reports the canonical priority, not whatever a provider claimed", () => {
    const card = resolve({ journey: journey(3) });
    expect(card?.priority).toBe(SMART_CARD_PRIORITY.journey);
  });
});

// ---------------------------------------------------------------------------
// Journey → Journey Complete transition
// ---------------------------------------------------------------------------

describe("journey completion transition", () => {
  it("shows the Journey card while steps remain", () => {
    const card = resolve({ journey: journey(7) });
    expect(card?.id).toBe("journey");
    expect(card?.progress?.percent).toBe(70);
  });

  it("switches to Journey Complete on the final step", () => {
    const card = resolve({ journey: journey(10) });
    expect(card?.id).toBe("journey_complete");
    expect(card?.progress?.percent).toBe(100);
  });

  it("marks Journey Complete dismissible and the in-progress Journey not", () => {
    expect(resolve({ journey: journey(10) })?.dismissible).toBe(true);
    expect(resolve({ journey: journey(4) })?.dismissible).toBeUndefined();
  });

  it("permanently advances past Journey Complete once acknowledged", () => {
    const acknowledged = new Set(["journey_complete"]);
    const card = resolve({ hasPremium: false }, acknowledged);
    expect(card?.id).toBe("membership");
  });

  it("still lets a higher-priority card override without consuming the acknowledgement", () => {
    // Not yet acknowledged, but Safe Arrival is live.
    const card = resolve({ safeArrival: { travelling: true, watcherCount: 1 } });
    expect(card?.id).toBe("safe_arrival");
    // With the override gone, Journey Complete is still there.
    expect(resolve({})?.id).toBe("journey_complete");
  });

  it("declines both journey cards when the journey never loaded", () => {
    const card = resolve({ journey: null, hasPremium: false });
    expect(card?.id).toBe("membership");
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe("smart card expiry", () => {
  it("skips a card whose expiry has passed", () => {
    const built = input({ journey: journey(3) });
    const providers = [
      { id: "journey" as SmartCardId, build: () => ({ ...smartCardProviders(built)[1].build()!, expiresAt: built.now.getTime() - 1 }) },
      ...smartCardProviders(built).filter((provider) => provider.id === "suggestions")
    ];
    const card = resolveSmartCard(providers, { now: built.now.getTime() });
    expect(card?.id).toBe("suggestions");
  });

  it("keeps a card whose expiry is still in the future", () => {
    const built = input({ journey: journey(3) });
    const providers = [
      { id: "journey" as SmartCardId, build: () => ({ ...smartCardProviders(built)[1].build()!, expiresAt: built.now.getTime() + 60_000 }) }
    ];
    const card = resolveSmartCard(providers, { now: built.now.getTime() });
    expect(card?.id).toBe("journey");
  });

  it("expires the birthday card at the end of the birthday itself", () => {
    const card = resolve({ birthday: { birthdayToday: true, birthdayTomorrow: false } }, PAST_JOURNEY);
    expect(card?.id).toBe("birthday");
    const expiry = new Date(card!.expiresAt!);
    expect(expiry.getDate()).toBe(WEDNESDAY.getDate());
    expect(expiry.getHours()).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// Weekend window
// ---------------------------------------------------------------------------

describe("weekend planning window", () => {
  it("opens Friday at 17:00 and not before", () => {
    expect(isWeekendPlanningWindow(new Date(2026, 7, 7, 16, 59))).toBe(false);
    expect(isWeekendPlanningWindow(new Date(2026, 7, 7, 17, 0))).toBe(true);
  });

  it("covers Saturday and Sunday", () => {
    expect(isWeekendPlanningWindow(new Date(2026, 7, 8, 9, 0))).toBe(true);
    expect(isWeekendPlanningWindow(new Date(2026, 7, 9, 22, 0))).toBe(true);
  });

  it("is closed midweek", () => {
    for (const day of [3, 4, 5, 6]) {
      expect(isWeekendPlanningWindow(new Date(2026, 7, day, 12, 0))).toBe(false);
    }
  });

  it("expires at the end of the coming Sunday from every point in the window", () => {
    for (const start of [new Date(2026, 7, 7, 18, 0), new Date(2026, 7, 8, 12, 0), new Date(2026, 7, 9, 20, 0)]) {
      const expiry = new Date(weekendWindowExpiry(start));
      expect(expiry.getDay()).toBe(0);
      expect(expiry.getDate()).toBe(9);
      expect(expiry.getHours()).toBe(23);
    }
  });

  it("only shows the weekend card inside the window", () => {
    expect(resolve({ weekendPlanCount: 2, hasPremium: false }, PAST_JOURNEY)?.id).not.toBe("weekend_plans");
    expect(
      resolve({ now: new Date(2026, 7, 8, 12, 0), weekendPlanCount: 2, hasPremium: false }, PAST_JOURNEY)?.id
    ).toBe("weekend_plans");
  });

  it("changes copy but not identity when plans already exist", () => {
    const saturday = new Date(2026, 7, 8, 12, 0);
    const empty = resolve({ now: saturday, weekendPlanCount: 0, hasPremium: false }, PAST_JOURNEY);
    const full = resolve({ now: saturday, weekendPlanCount: 3, hasPremium: false }, PAST_JOURNEY);
    expect(empty?.id).toBe(full?.id);
    expect(empty?.title).not.toBe(full?.title);
  });
});

// ---------------------------------------------------------------------------
// Membership eligibility
// ---------------------------------------------------------------------------

describe("membership card eligibility", () => {
  it("never shows to a user who already has premium", () => {
    const card = resolve({ hasPremium: true }, new Set(["journey_complete"]));
    expect(card?.id).not.toBe("membership");
  });

  it("shows to a user without premium once nothing above it applies", () => {
    const card = resolve({ hasPremium: false }, new Set(["journey_complete"]));
    expect(card?.id).toBe("membership");
  });
});

// ---------------------------------------------------------------------------
// Buddy progress
// ---------------------------------------------------------------------------

describe("buddy progress card", () => {
  const acknowledged = new Set(["journey_complete"]);

  it("declines at the top level, where there is no next level", () => {
    const card = resolve({ buddyScore: { nextLevel: null, pointsToNext: 0, progressPercent: 100 } }, acknowledged);
    expect(card?.id).not.toBe("buddy_progress");
  });

  it("shows the points remaining to the next level", () => {
    const card = resolve(
      { buddyScore: { nextLevel: { key: "trusted", label: "Trusted Buddy", minimum: 200 }, pointsToNext: 45, progressPercent: 77 } },
      acknowledged
    );
    expect(card?.id).toBe("buddy_progress");
    expect(card?.title).toContain("45");
    expect(card?.progress?.percent).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// Progress clamping
// ---------------------------------------------------------------------------

describe("smart card progress", () => {
  it("clamps into 0–100 and rounds", () => {
    expect(smartCardProgress(3, 10, "x").percent).toBe(30);
    expect(smartCardProgress(0, 0, "x").percent).toBe(0);
    expect(smartCardProgress(15, 10, "x").percent).toBe(100);
    expect(smartCardProgress(-4, 10, "x").percent).toBe(0);
  });

  it("singularises the remaining-step label", () => {
    expect(resolve({ journey: journey(9) })?.progress?.label).toBe("One step remaining");
    expect(resolve({ journey: journey(7) })?.progress?.label).toBe("3 steps remaining");
  });
});

// ---------------------------------------------------------------------------
// Architecture — content comes from the server, not the component
// ---------------------------------------------------------------------------

describe("smart card architecture", () => {
  it("keeps card copy out of the UI component", () => {
    const component = read("components/journey/smart-card.tsx");
    // Titles and CTAs live in the providers; the component only renders fields.
    for (const copy of ["Continue Journey", "Journey complete", "Unlock Buddy Plus", "Happy birthday"]) {
      expect(component, `card copy "${copy}" must not be hardcoded in the component`).not.toContain(copy);
    }
    expect(component).toContain("{card.title}");
    expect(component).toContain("{card.subtitle}");
    expect(component).toContain("{card.cta}");
  });

  it("renders exactly one card on Home — no list, no carousel", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).toContain("<SmartCardHero card={smartCard} />");
    expect(home).not.toContain("smartCards");
    expect(home).not.toContain(".map((card");
  });

  it("selects the card server-side, not in the client component", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).not.toContain("resolveSmartCard");
    expect(read("app/(app)/dashboard/page.tsx")).toContain("loadSmartCard");
  });

  it("keeps the card frame fixed across states", () => {
    const component = read("components/journey/smart-card.tsx");
    // One Link, one radius, one gradient — the shell cannot vary per card.
    expect(component.match(/rounded-\[1\.75rem\]/g)?.length).toBe(1);
    expect(component.match(/linear-gradient\(118deg/g)?.length).toBe(1);
  });

  it("validates the acknowledged card id against the canonical list", () => {
    const action = read("app/(app)/smart-card-actions.ts");
    expect(action).toContain("SMART_CARD_IDS");
    expect(action).toContain("auth.getUser()");
  });

  it("scopes acknowledgement writes to the signed-in user", () => {
    const service = read("lib/smart-card/smart-card-service.ts");
    expect(service).toContain("user_id: userId");
    const migration = read("supabase/migrations/20260805120000_smart_card_acknowledgements.sql");
    expect(migration).toContain("auth.uid() = user_id");
    expect(migration).toContain("enable row level security");
  });
});
