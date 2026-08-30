import { describe, expect, it } from "vitest";
import {
  UPFOR_MIN_LEAD_MINUTES,
  UPFOR_SLOT_MINUTES,
  upForTimeSlots
} from "@/lib/social/upfor-schedule-options";
import { validateLaterToday } from "@/lib/time/timezone";

const ACCRA = "Africa/Accra"; // UTC+0 year-round, so ISO reads as wall-clock.

describe("the picker only offers times that are still available today", () => {
  it("starts at the next slot boundary beyond the lead time", () => {
    // 14:20 + 15m lead = 14:35 -> rounds up to 15:00.
    const slots = upForTimeSlots(new Date("2026-07-17T14:20:00Z"), ACCRA);
    expect(slots[0]?.iso).toBe("2026-07-17T15:00:00.000Z");
  });

  it("never offers a time sooner than the lead time", () => {
    const now = new Date("2026-07-17T14:29:00Z");
    const slots = upForTimeSlots(now, ACCRA);
    const firstMs = Date.parse(slots[0]!.iso);
    expect(firstMs - now.getTime()).toBeGreaterThanOrEqual(UPFOR_MIN_LEAD_MINUTES * 60_000);
  });

  it("stops at the end of the local day, never spilling into tomorrow", () => {
    const slots = upForTimeSlots(new Date("2026-07-17T14:20:00Z"), ACCRA);
    const last = slots[slots.length - 1]!;
    expect(last.iso).toBe("2026-07-17T23:30:00.000Z");
    for (const slot of slots) {
      expect(slot.iso.startsWith("2026-07-17"), slot.iso).toBe(true);
    }
  });

  it("offers nothing when the day has effectively run out", () => {
    // 23:50: the next boundary past the lead time is already tomorrow, so the
    // honest answer is an empty picker rather than an option the server will
    // reject.
    expect(upForTimeSlots(new Date("2026-07-17T23:50:00Z"), ACCRA)).toEqual([]);
  });

  it("spaces slots by the stated granularity", () => {
    const slots = upForTimeSlots(new Date("2026-07-17T09:00:00Z"), ACCRA);
    for (let i = 1; i < slots.length; i += 1) {
      const gap = Date.parse(slots[i]!.iso) - Date.parse(slots[i - 1]!.iso);
      expect(gap).toBe(UPFOR_SLOT_MINUTES * 60_000);
    }
  });

  it("returns nothing for an unusable timezone rather than throwing", () => {
    expect(upForTimeSlots(new Date("2026-07-17T14:20:00Z"), "Mars/Olympus")).toEqual([]);
  });
});

describe("the picker and the server agree", () => {
  it("every offered slot passes the server's own Later today rule", () => {
    // The point of the whole module: the UI must not offer anything the server
    // will refuse. Checked against the real validator, not a copy of its logic.
    for (const nowIso of [
      "2026-07-17T06:05:00Z",
      "2026-07-17T14:20:00Z",
      "2026-07-17T21:47:00Z",
      "2026-07-17T23:14:00Z"
    ]) {
      const now = new Date(nowIso);
      for (const slot of upForTimeSlots(now, ACCRA)) {
        expect(validateLaterToday(new Date(slot.iso), now, ACCRA), `${nowIso} -> ${slot.iso}`).toEqual({
          ok: true
        });
      }
    }
  });

  it("agrees in a DST-capable zone too", () => {
    // London springs forward on 2026-03-29: that local day is 23 hours long.
    // Slots are derived by offsetting from now, so the short day needs no
    // special case -- but it must still be checked.
    const now = new Date("2026-03-29T08:20:00Z");
    const slots = upForTimeSlots(now, "Europe/London");
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(validateLaterToday(new Date(slot.iso), now, "Europe/London"), slot.iso).toEqual({ ok: true });
    }
  });

  it("agrees in a zone offset from the server's own", () => {
    // 23:30 UTC is already the next local day in Kolkata, so "later today"
    // there is a different window entirely.
    const now = new Date("2026-07-17T14:20:00Z");
    for (const slot of upForTimeSlots(now, "Asia/Kolkata")) {
      expect(validateLaterToday(new Date(slot.iso), now, "Asia/Kolkata"), slot.iso).toEqual({ ok: true });
    }
  });
});
