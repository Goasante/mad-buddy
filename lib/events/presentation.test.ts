import { describe, expect, it } from "vitest";
import {
  AUDIENCE_EXPLANATION,
  byStartAscending,
  describeEvent,
  eventWhenLabel,
  pickHeroEvent
} from "@/lib/events/presentation";

/**
 * The Events surfaces claim things about time: "Live now", "Today", the hero.
 * A wrong claim here is a user walking to a venue on the wrong day, so these
 * pin the boundaries rather than the happy middle of each range.
 */

const NOW = Date.parse("2026-08-18T14:00:00.000Z");
const at = (startIso: string, hours = 3) => ({
  startsAt: startIso,
  endsAt: new Date(Date.parse(startIso) + hours * 3_600_000).toISOString()
});

describe("what an Event's time reads as", () => {
  it("says Live now while it is running, never the start time", () => {
    // Mid-Event, the start time is not the useful fact.
    expect(eventWhenLabel(at("2026-08-18T13:00:00.000Z"), NOW)).toBe("Live now");
  });

  it("treats the instant of the start as live, not as upcoming", () => {
    const starts = "2026-08-18T14:00:00.000Z";
    expect(eventWhenLabel(at(starts), Date.parse(starts))).toBe("Live now");
  });

  it("treats the instant of the end as over, not still live", () => {
    /* Boundary: endsAt is exclusive, so an Event does not linger as live.
     *
     * Asserted through describeEvent rather than the label. The label routes
     * through toLocaleDateString, which resolves against the RUNNING MACHINE's
     * timezone -- so a label assertion here passes or fails depending on where
     * the test happens to run, which is exactly the flake this avoids. The
     * phase itself is timezone-independent. */
    const ends = Date.parse("2026-08-18T17:00:00.000Z");
    const atEnd = describeEvent(at("2026-08-18T14:00:00.000Z"), ends);
    expect(atEnd.isLive).toBe(false);
    expect(atEnd.isPast).toBe(true);

    // And one millisecond earlier it is still live, which is what makes the
    // assertion above about the boundary rather than about being far past it.
    const justBefore = describeEvent(at("2026-08-18T14:00:00.000Z"), ends - 1);
    expect(justBefore.isLive).toBe(true);
  });

  /* Day-relative cases are built from the RUNNING MACHINE's local midnight
   * rather than from fixed UTC instants.
   *
   * "Today" is a local-calendar question, so a fixed UTC timestamp lands on a
   * different day either side of the date line -- an assertion written that way
   * passes in one timezone and fails in another. Offsetting from local midnight
   * asks the question the code actually answers. */
  const localDayAt = (days: number, hour: number) => {
    const date = new Date(NOW);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    date.setHours(hour);
    return date.toISOString();
  };

  it("names Today and Tomorrow rather than making anyone read a date", () => {
    /* Late in the local day for the "today" case: NOW is 14:00 UTC, so an
     * Event pinned at local noon may already be RUNNING on some machines, and
     * a running Event correctly reads "Live now" rather than "Today". 23:00
     * is after NOW in every timezone. */
    expect(eventWhenLabel(at(localDayAt(0, 23)), NOW)).toContain("Today");
    expect(eventWhenLabel(at(localDayAt(1, 12)), NOW)).toContain("Tomorrow");
  });

  it("uses a weekday inside the coming week and a date beyond it", () => {
    const weekday = eventWhenLabel(at(localDayAt(3, 12)), NOW);
    expect(weekday).not.toContain("Today");
    expect(weekday).not.toContain("Tomorrow");
    // Four weeks out must not read as a bare weekday -- "Tue" would be a lie
    // about WHICH Tuesday. A month name is the tell that it switched formats.
    expect(eventWhenLabel(at(localDayAt(28, 12)), NOW)).toMatch(/[A-Z][a-z]{2} \d/);
  });

  it("returns empty rather than Invalid Date for an unparseable start", () => {
    expect(eventWhenLabel({ startsAt: "not-a-date", endsAt: "also-not" }, NOW)).toBe("");
  });
});

describe("which section an Event belongs in", () => {
  it("never lets Today and This week claim the same Event", () => {
    const today = describeEvent(at("2026-08-18T20:00:00.000Z"), NOW);
    expect(today.isToday).toBe(true);
    expect(today.isThisWeek).toBe(false);
  });

  it("counts a live Event as live and not as past", () => {
    const live = describeEvent(at("2026-08-18T13:00:00.000Z"), NOW);
    expect(live.isLive).toBe(true);
    expect(live.isPast).toBe(false);
  });

  it("marks a finished Event past", () => {
    expect(describeEvent(at("2026-08-10T13:00:00.000Z"), NOW).isPast).toBe(true);
  });
});

describe("the Home hero", () => {
  const live = { id: "live", ...at("2026-08-18T13:00:00.000Z") };
  const soon = { id: "soon", ...at("2026-08-18T22:00:00.000Z") };
  const later = { id: "later", ...at("2026-08-25T22:00:00.000Z") };
  const over = { id: "over", ...at("2026-08-01T22:00:00.000Z") };

  it("promotes a live Event over anything merely upcoming", () => {
    // "What's happening" means now, not soonest.
    expect(pickHeroEvent([later, soon, live], NOW)?.id).toBe("live");
  });

  it("falls back to the soonest Event that has not started", () => {
    expect(pickHeroEvent([later, soon], NOW)?.id).toBe("soon");
  });

  it("returns null rather than heroing something already over", () => {
    // A stale hero misrepresents the whole surface.
    expect(pickHeroEvent([over], NOW)).toBeNull();
  });

  it("returns null on an empty list instead of throwing", () => {
    expect(pickHeroEvent([], NOW)).toBeNull();
  });
});

describe("ordering", () => {
  it("sorts ascending so a list reads as a timeline", () => {
    const rows = [{ startsAt: "2026-08-20T10:00:00.000Z" }, { startsAt: "2026-08-19T10:00:00.000Z" }];
    expect([...rows].sort(byStartAscending)[0].startsAt).toContain("08-19");
  });
});

describe("audience explanations promise only what exists", () => {
  it("tells an unlisted host the Event stays out of discovery", () => {
    expect(AUDIENCE_EXPLANATION.link.lines.join(" ")).toContain("not appear in discovery");
  });

  it("names only surfaces that are actually built", () => {
    const publicCopy = AUDIENCE_EXPLANATION.public.lines.join(" ");
    expect(publicCopy).toContain("Home, Discover and Near you");
    // Search is not built. Promising it would be a lie in the product's voice.
    expect(publicCopy.toLowerCase()).not.toContain("search");
  });
});
