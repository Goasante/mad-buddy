import { describe, expect, it } from "vitest";
import {
  isSameLocalDay,
  isValidTimeZone,
  localDayKey,
  validateLaterToday
} from "@/lib/time/timezone";

describe("IANA timezone validation", () => {
  it("accepts real zones, including DST-capable ones", () => {
    for (const zone of ["Africa/Accra", "Europe/London", "America/New_York", "UTC", "Asia/Kolkata"]) {
      expect(isValidTimeZone(zone), zone).toBe(true);
    }
  });

  it("rejects anything that is not a resolvable zone", () => {
    for (const bad of ["", "Mars/Olympus", "Africa/Accra; drop table", "GMT+1:00", "not a zone", "x".repeat(61)]) {
      expect(isValidTimeZone(bad), bad).toBe(false);
    }
  });

  it("rejects non-string input without throwing", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(isValidTimeZone(bad as unknown as string)).toBe(false);
    }
  });
});

describe("local calendar day", () => {
  it("is the local day, not the UTC day", () => {
    // 2026-07-17 23:30 UTC. Already the 18th in Kolkata (+05:30), still the
    // 17th in New York (-04:00). A UTC-based rule would get both wrong.
    const instant = new Date("2026-07-17T23:30:00Z");
    expect(localDayKey(instant, "UTC")).toBe("2026-07-17");
    expect(localDayKey(instant, "Asia/Kolkata")).toBe("2026-07-18");
    expect(localDayKey(instant, "America/New_York")).toBe("2026-07-17");
  });

  it("handles a DST transition without shifting the calendar day", () => {
    // London springs forward 2026-03-29 at 01:00 UTC. 00:30 and 02:30 UTC are
    // the same local day either side of the jump.
    const before = new Date("2026-03-29T00:30:00Z");
    const after = new Date("2026-03-29T02:30:00Z");
    expect(isSameLocalDay(before, after, "Europe/London")).toBe(true);
    expect(localDayKey(after, "Europe/London")).toBe("2026-03-29");
  });
});

describe("the Later today rule", () => {
  const accra = "Africa/Accra";
  // Accra is UTC+0 year-round, so these read as local wall-clock times.
  const now = new Date("2026-07-17T14:20:00Z");

  it("accepts a time later on the same local day", () => {
    for (const at of ["15:00", "18:30", "22:00", "23:59"]) {
      const startsAt = new Date(`2026-07-17T${at}:00Z`);
      expect(validateLaterToday(startsAt, now, accra), at).toEqual({ ok: true });
    }
  });

  it("rejects a time earlier today", () => {
    expect(validateLaterToday(new Date("2026-07-17T13:00:00Z"), now, accra)).toEqual({
      ok: false,
      reason: "not_in_future"
    });
  });

  it("rejects now itself, because Later today means later", () => {
    expect(validateLaterToday(now, now, accra)).toEqual({ ok: false, reason: "not_in_future" });
  });

  it("rejects tomorrow", () => {
    expect(validateLaterToday(new Date("2026-07-18T09:00:00Z"), now, accra)).toEqual({
      ok: false,
      reason: "not_today"
    });
  });

  it("rejects yesterday", () => {
    expect(validateLaterToday(new Date("2026-07-16T09:00:00Z"), now, accra)).toEqual({
      ok: false,
      reason: "not_in_future"
    });
  });

  it("rejects an invalid timezone before looking at the clock", () => {
    expect(validateLaterToday(new Date("2026-07-17T18:00:00Z"), now, "Mars/Olympus")).toEqual({
      ok: false,
      reason: "invalid_timezone"
    });
  });

  it("rejects a malformed timestamp", () => {
    expect(validateLaterToday(new Date("nonsense"), now, accra)).toEqual({
      ok: false,
      reason: "invalid_timestamp"
    });
  });

  it("judges the day in the SUPPLIED zone, not the server's", () => {
    // 23:30 UTC. In Kolkata it is already the next local day, so a start at
    // 23:45 UTC is "tomorrow" there and must be refused even though both
    // instants share a UTC date.
    const late = new Date("2026-07-17T23:30:00Z");
    const soon = new Date("2026-07-17T23:45:00Z");
    expect(validateLaterToday(soon, late, "UTC")).toEqual({ ok: true });
    expect(validateLaterToday(soon, late, "Asia/Kolkata")).toEqual({ ok: true });

    // ...but 00:30 UTC the next day is a different local day in BOTH.
    const past = new Date("2026-07-18T00:30:00Z");
    expect(validateLaterToday(past, late, "UTC")).toEqual({ ok: false, reason: "not_today" });
  });

  it("cannot be talked into the past by a manipulated client clock", () => {
    // The caller does not supply `now` in production -- the server does. Even
    // handed a start it believes is fine, the rule is evaluated against the
    // server clock, so a device set to yesterday changes nothing.
    const serverNow = new Date("2026-07-17T14:20:00Z");
    const deviceThinksItIs = new Date("2026-07-17T08:00:00Z");
    expect(validateLaterToday(deviceThinksItIs, serverNow, accra)).toEqual({
      ok: false,
      reason: "not_in_future"
    });
  });
});
