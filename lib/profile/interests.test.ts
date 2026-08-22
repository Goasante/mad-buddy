import { describe, expect, it } from "vitest";

import {
  CANONICAL_INTERESTS,
  MAX_INTEREST_LENGTH,
  MAX_INTERESTS,
  canonicalizeInterest,
  diffInterests,
  isCanonicalInterest,
  toDisplayInterests,
  validateInterestSelection
} from "./interests";

describe("canonical taxonomy", () => {
  it("stays within the column's length check", () => {
    // The table is `check (char_length(interest) between 1 and 40)`. A value
    // longer than that would be rejected by Postgres at insert time.
    for (const interest of CANONICAL_INTERESTS) {
      expect(interest.length).toBeGreaterThan(0);
      expect(interest.length).toBeLessThanOrEqual(MAX_INTEREST_LENGTH);
    }
  });

  it("has no duplicates, case-insensitively", () => {
    const keys = CANONICAL_INTERESTS.map((interest) => interest.toLowerCase());
    expect(new Set(keys).size).toBe(CANONICAL_INTERESTS.length);
  });

  it("offers more choices than one profile may hold", () => {
    expect(CANONICAL_INTERESTS.length).toBeGreaterThan(MAX_INTERESTS);
  });
});

describe("canonicalizeInterest", () => {
  it("matches regardless of casing or surrounding space", () => {
    expect(canonicalizeInterest("music")).toBe("Music");
    expect(canonicalizeInterest("  COFFEE ")).toBe("Coffee");
  });

  it("returns null for a value outside the taxonomy", () => {
    expect(canonicalizeInterest("Competitive Yodelling")).toBeNull();
  });

  it("agrees with isCanonicalInterest", () => {
    expect(isCanonicalInterest("gaming")).toBe(true);
    expect(isCanonicalInterest("not-a-real-interest")).toBe(false);
  });
});

describe("validateInterestSelection", () => {
  it("accepts a canonical selection and returns canonical spellings", () => {
    const result = validateInterestSelection(["music", "COFFEE"]);
    expect(result).toEqual({ ok: true, interests: ["Music", "Coffee"] });
  });

  it("accepts an empty selection — clearing every interest is legitimate", () => {
    expect(validateInterestSelection([])).toEqual({ ok: true, interests: [] });
  });

  it("collapses duplicates rather than rejecting them", () => {
    const result = validateInterestSelection(["Music", "music", " Music "]);
    expect(result).toEqual({ ok: true, interests: ["Music"] });
  });

  it("rejects a value that is not in the taxonomy", () => {
    // The picker cannot produce this, so it means a hand-made request.
    const result = validateInterestSelection(["Music", "<script>alert(1)</script>"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_canonical");
  });

  it("rejects more than the maximum", () => {
    const result = validateInterestSelection(CANONICAL_INTERESTS.slice(0, MAX_INTERESTS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("too_many");
  });

  it("accepts exactly the maximum", () => {
    const result = validateInterestSelection(CANONICAL_INTERESTS.slice(0, MAX_INTERESTS));
    expect(result.ok).toBe(true);
  });
});

describe("toDisplayInterests", () => {
  it("keeps a legacy value instead of dropping it", () => {
    // Anything written before the taxonomy existed still belongs to the
    // person who chose it; hiding it would look like data loss.
    const display = toDisplayInterests(["Music", "Amapiano"]);
    expect(display).toEqual([
      { value: "Music", canonical: true },
      { value: "Amapiano", canonical: false }
    ]);
  });

  it("normalises a legacy casing onto the canonical chip", () => {
    expect(toDisplayInterests(["music"])).toEqual([{ value: "Music", canonical: true }]);
  });

  it("drops blanks and duplicates", () => {
    expect(toDisplayInterests(["Music", "  ", "music"])).toEqual([
      { value: "Music", canonical: true }
    ]);
  });
});

describe("diffInterests", () => {
  it("returns only what actually changed", () => {
    expect(diffInterests(["Music", "Coffee"], ["Music", "Gaming"])).toEqual({
      add: ["Gaming"],
      remove: ["Coffee"]
    });
  });

  it("is a no-op when the selection is unchanged", () => {
    expect(diffInterests(["Music"], ["music"])).toEqual({ add: [], remove: [] });
  });

  it("removes a legacy value the person deselected", () => {
    expect(diffInterests(["Amapiano"], [])).toEqual({ add: [], remove: ["Amapiano"] });
  });

  it("leaves an untouched legacy value alone", () => {
    // A save that keeps the legacy chip selected must not delete and
    // re-insert it, which would churn created_at and reorder the list.
    expect(diffInterests(["Amapiano", "Music"], ["Amapiano", "Music"])).toEqual({
      add: [],
      remove: []
    });
  });
});
