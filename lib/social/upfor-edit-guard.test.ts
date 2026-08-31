import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  replacementEditVerdict,
  upForEditBlockedMessage
} from "@/lib/social/upfor-lifecycle";
import { HANGOUT_ACTIVITY_LABELS, HANGOUT_ACTIVITY_TYPES } from "@/lib/social/plans";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const NOW = Date.parse("2026-08-31T10:00:00.000Z");
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

/**
 * Defect A. The database CHECK, the generated type and the labels all carried
 * fourteen activities while the server action's validation still listed eight.
 * Editing one of the missing six ended the session and then failed validation,
 * destroying it and creating nothing.
 */
describe("the activity contract agrees with the database", () => {
  it("carries all fourteen canonical activities", () => {
    expect(HANGOUT_ACTIVITY_TYPES).toHaveLength(14);
  });

  it("includes the six the 20260822120000 migration added", () => {
    for (const late of ["coffee", "football", "drinks", "movie", "drive", "party"]) {
      expect(HANGOUT_ACTIVITY_TYPES, late).toContain(late);
    }
  });

  it("can label every activity it accepts", () => {
    // A value the server accepts but cannot name would render as "Anything".
    for (const type of HANGOUT_ACTIVITY_TYPES) {
      expect(HANGOUT_ACTIVITY_LABELS[type], type).toBeTruthy();
    }
  });

  it("validates against the canonical list rather than a second copy", () => {
    const actions = read("app/(app)/hangout-actions.ts");
    expect(actions).toContain("z.enum(HANGOUT_ACTIVITY_TYPES");
    // The stale literal list is what drifted; it must not come back.
    expect(actions).not.toContain('z.enum(["food", "study", "sports"');
  });
});

/**
 * Defect B. Editing replaces the row, so it must not run where that would
 * discard someone else's response or restart a running clock.
 */
describe("replacement edit refuses to destroy state", () => {
  const scheduled = { status: "active", startsAt: iso(120) };
  const live = { status: "active", startsAt: iso(-10) };

  it("allows a scheduled UpFor nobody has responded to", () => {
    expect(replacementEditVerdict(scheduled, 0, NOW)).toEqual({ ok: true });
  });

  it("blocks one that has already started", () => {
    expect(replacementEditVerdict(live, 0, NOW)).toEqual({ ok: false, reason: "already_live" });
  });

  it("blocks a scheduled UpFor once anyone has responded", () => {
    expect(replacementEditVerdict(scheduled, 1, NOW)).toEqual({
      ok: false,
      reason: "has_responses"
    });
  });

  it("reports the response as the reason even when it is also live", () => {
    // The owner needs to know a person is involved, not just that time passed.
    expect(replacementEditVerdict(live, 2, NOW)).toEqual({ ok: false, reason: "has_responses" });
  });

  it("blocks an UpFor that is already over", () => {
    for (const status of ["cancelled", "expired", "converted_to_plan"]) {
      expect(replacementEditVerdict({ status, startsAt: iso(120) }, 0, NOW)).toEqual({
        ok: false,
        reason: "not_editable"
      });
    }
  });

  it("refuses rather than guesses when the start is missing or unparseable", () => {
    for (const startsAt of [null, "not-a-date"]) {
      expect(replacementEditVerdict({ status: "active", startsAt }, 0, NOW)).toEqual({
        ok: false,
        reason: "already_live"
      });
    }
  });

  it("treats the boundary instant as started", () => {
    expect(replacementEditVerdict({ status: "active", startsAt: iso(0) }, 0, NOW)).toEqual({
      ok: false,
      reason: "already_live"
    });
  });

  it("explains each refusal in the owner's language", () => {
    expect(upForEditBlockedMessage("has_responses")).toMatch(/responded/i);
    expect(upForEditBlockedMessage("already_live")).toMatch(/already live/i);
    expect(upForEditBlockedMessage("not_editable")).toMatch(/over/i);
  });
});

describe("the guard is server authority, not a hidden button", () => {
  const actions = read("app/(app)/hangout-actions.ts");

  it("exposes the eligibility check as its own action", () => {
    expect(actions).toContain("export async function canEditUpForAction");
  });

  it("re-checks inside the destructive path", () => {
    // A stale client calling endHangoutAction directly must not get through.
    expect(actions).toContain("if (forEdit) {");
    expect(actions).toContain("replacementEditVerdictFor(hangoutId, userId)");
  });

  it("decides eligibility before anything is cancelled", () => {
    const guard = actions.indexOf("if (forEdit) {");
    const cancel = actions.indexOf('.update({ status: "cancelled"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(cancel);
  });

  it("counts accepted responses too, not only pending ones", () => {
    expect(actions).toContain('.in("status", ["pending", "accepted", "maybe"])');
  });
});

describe("the edit page keeps the schedule it was given", () => {
  const page = read("components/hangout/hangout-mode-page.tsx");

  it("asks the server before opening the edit sheet", () => {
    expect(page).toContain("await canEditUpForAction(target.id)");
  });

  it("declares the end as part of an edit", () => {
    expect(page).toContain("endHangoutAction(previousId, true)");
  });

  it("restores a future start instead of defaulting to now", () => {
    // Defaulting to "now" moved a scheduled UpFor to the moment it was edited.
    expect(page).toContain('setWhen("later")');
    expect(page).toContain("setStartAtIso(new Date(startsMs).toISOString())");
  });
});
