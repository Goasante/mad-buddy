import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const home = read("components/dashboard/dashboard-page.tsx");
const service = read("lib/social/upcoming-plans.ts");

/** The Upcoming Plans card + empty state, isolated from the rest of Home. */
const section = home.slice(
  home.indexOf("function UpcomingPlanRow"),
  home.indexOf("// Helpers")
);

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("Home plan selection", () => {
  it("shows exactly one plan", () => {
    expect(home).toContain("const plan = upcomingPlans[0];");
  });

  it("reuses the server ordering rather than ranking on the client", () => {
    // Soonest first, decided by the query.
    expect(service).toContain('.order("start_at", { ascending: true })');
    // No client-side sort of the plan list on Home.
    expect(home).not.toContain("upcomingPlans.sort");
    expect(home).not.toContain("[...upcomingPlans]");
  });

  it("renders the empty state instead of hiding the section", () => {
    expect(home).toContain("{plan ? <UpcomingPlanRow plan={plan} /> : <UpcomingPlanEmpty />}");
  });

  it("sits directly after Near and above Quick Actions", () => {
    const near = home.indexOf("<NearbyHero");
    const plans = home.indexOf("{plan ? <UpcomingPlanRow");
    const quickActions = home.indexOf("<QuickActionsHome");
    expect(near).toBeLessThan(plans);
    expect(plans).toBeLessThan(quickActions);
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("Upcoming Plans header", () => {
  it("uses the same pattern as Near", () => {
    expect(section).toContain("Upcoming Plans");
    expect(section).toContain("text-[1.75rem] font-bold leading-none tracking-tight");
    expect(section).toContain("text-base font-medium text-[var(--color-brand-orange)]");
  });

  it("points See all at the canonical Plans page", () => {
    expect(section).toContain('href="/plans"');
    expect(section).toContain("See all");
  });
});

// ---------------------------------------------------------------------------
// Card content + hierarchy
// ---------------------------------------------------------------------------

describe("Upcoming Plan card", () => {
  it("makes the title the strongest text", () => {
    // The title is the only semibold line; date/time and venue are muted.
    expect(section).toMatch(/text-\[0\.9375rem\] font-semibold leading-tight[\s\S]{0,40}\{capitalize\(plan\.title\)\}/);
  });

  it("shows date, time and venue as secondary scannable lines", () => {
    expect(section).toContain("{day} • {time}");
    expect(section).toContain("{capitalize(plan.placeText)}");
    expect(section).toContain("text-[0.8125rem] leading-tight text-muted-foreground");
  });

  it("splits date and time so they can carry different weight", () => {
    expect(section).toContain("toLocaleDateString");
    expect(section).toContain("toLocaleTimeString");
  });

  it("omits the venue line entirely when the plan has no place", () => {
    expect(section).toContain("{plan.placeText ? (");
  });

  it("uses only the authorised venue projection, never coordinates", () => {
    expect(section).not.toContain("latitude");
    expect(section).not.toContain("longitude");
    expect(section).not.toContain("address");
    // custom_place_text is the only venue field the projection carries.
    expect(service).toContain("placeText: plan.custom_place_text");
  });

  it("truncates every text line rather than wrapping", () => {
    const truncations = section.match(/truncate/g) ?? [];
    expect(truncations.length).toBeGreaterThanOrEqual(3);
  });

  it("stays compact — no tall media block or gradient", () => {
    expect(section).not.toContain("aspect-");
    expect(section).not.toContain("bg-gradient-to");
    expect(section).not.toContain("h-32");
  });
});

// ---------------------------------------------------------------------------
// Visual style
// ---------------------------------------------------------------------------

describe("Upcoming Plan card style", () => {
  it("uses a 22px radius with a subtle border and restrained shadow", () => {
    expect(section).toContain("rounded-[1.375rem]");
    expect(section).toContain("border border-border/70");
    expect(section).toContain("shadow-[0_1px_3px_hsl(var(--shadow)/0.06)]");
  });

  it("uses a theme surface rather than a hardcoded light background", () => {
    expect(section).toContain("bg-card");
    expect(section).toContain("dark:bg-[#1a1a1d]");
  });
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

describe("Upcoming Plan attendance state", () => {
  it("derives Hosting from the existing organiser projection, not a new field", () => {
    expect(section).toContain('plan.organiserName === "You" ? "Hosting" : rsvpLabel(plan.myRsvp)');
    expect(service).toContain('organiserName: plan.creator_id === userId ? "You"');
  });

  it("reuses the canonical rsvp labels rather than inventing states", () => {
    const labels = home.slice(home.indexOf("function rsvpLabel"), home.indexOf("function UpcomingPlanRow"));
    expect(labels).toContain('"Going"');
    expect(labels).toContain('"Maybe"');
    expect(labels).toContain('"Not going"');
    expect(labels).toContain('"Respond"');
  });

  it("renders the state as a small restrained pill", () => {
    expect(section).toContain('rounded-full bg-primary/12 px-2 py-0.5 text-[0.6875rem] font-semibold');
  });
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

describe("Upcoming Plan participants", () => {
  it("caps the face stack and derives the overflow from the canonical count", () => {
    expect(section).toContain("plan.attendees.slice(0, 3)");
    expect(section).toContain("Math.max(0, plan.goingCount - plan.attendees.slice(0, 3).length)");
  });

  it("never infers a membership tier for attendees", () => {
    // The attendee projection carries name + avatarUrl only.
    expect(section).not.toContain("membershipTier");
    expect(section).not.toContain("avatar-ring-plus");
    expect(section).not.toContain("avatar-ring-pro");
    expect(service).not.toContain("membership_tier");
  });

  it("applies no proximity glow at this size", () => {
    expect(section).not.toContain("GlowAvatar");
    expect(section).not.toContain("proximity-halo");
  });

  it("hides the faces on narrow screens but keeps the count", () => {
    // Faces are decorative; the title, time and venue are not.
    expect(section).toContain("hidden -space-x-2 min-[380px]:flex");
    expect(section).toContain("{plan.goingCount} going");
  });

  it("omits the stack entirely when nobody has RSVP'd going", () => {
    expect(section).toContain("{plan.attendees.length > 0 ? (");
  });
});

// ---------------------------------------------------------------------------
// Interaction + accessibility
// ---------------------------------------------------------------------------

describe("Upcoming Plan interaction", () => {
  it("makes the whole card tappable to the canonical Plans destination", () => {
    // There is no /plans/[id] route in the app, so this is the existing
    // destination the previous preview used — no new navigation.
    const card = section.slice(section.indexOf("<Link"), section.indexOf("</Link>"));
    expect(card).toContain('href="/plans"');
  });

  it("uses subtle press feedback that respects reduced motion", () => {
    expect(section).toContain("active:scale-[0.99]");
    expect(section).toContain("motion-reduce:active:scale-100");
  });

  it("gives one accessible label with title, date, time, venue and state", () => {
    expect(section).toContain("aria-label={`${capitalize(plan.title)}, ${day} at ${time}");
    expect(section).toContain("${attendance}`}");
  });

  it("hides the decorative avatar stack from screen readers", () => {
    // The count and state are already in the card's own aria-label.
    const stack = section.slice(section.indexOf("plan.attendees.length > 0"));
    expect(stack.slice(0, 600)).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("Upcoming Plans empty state", () => {
  const empty = section.slice(section.indexOf("function UpcomingPlanEmpty"));

  it("is a light invitation, not a large empty card", () => {
    expect(empty).not.toContain("glass-panel");
    expect(empty).not.toContain("py-8");
    expect(empty).not.toContain("rounded-[1.5rem]");
  });

  it("uses the specified copy", () => {
    expect(empty).toContain("No upcoming Plans.");
    expect(empty).toContain("Create a Plan");
    expect(empty).toContain("with your Muddies.");
  });

  it("reuses the canonical creation route", () => {
    expect(empty).toContain('href="/plans?create=1"');
  });

  it("keeps the section heading so the page structure does not shift", () => {
    expect(empty).toContain("Upcoming Plans");
  });
});
