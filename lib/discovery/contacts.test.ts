import { describe, expect, it } from "vitest";
import {
  MAX_CONTACTS_PER_MATCH,
  normalizeEmail,
  normalizePhone,
  protectIdentifier,
  protectIdentifierBatch,
  validateBulkInviteCount
} from "@/lib/discovery/contacts";

const PEPPER = "test-server-pepper";

describe("normalizePhone (spec §41, §47)", () => {
  it("maps local and international forms of the same number to one value", () => {
    const canonical = "+233241234567";
    expect(normalizePhone("+233241234567", "233")).toBe(canonical);
    expect(normalizePhone("024 123 4567", "233")).toBe(canonical);
    expect(normalizePhone("0241234567", "233")).toBe(canonical);
    expect(normalizePhone("00233241234567", "233")).toBe(canonical);
    expect(normalizePhone("(024) 123-4567", "233")).toBe(canonical);
  });

  it("rejects junk and implausible lengths", () => {
    expect(normalizePhone("", "233")).toBeNull();
    expect(normalizePhone("12345", "233")).toBeNull();
    expect(normalizePhone("abc", "233")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims, and rejects invalid addresses", () => {
    expect(normalizeEmail("  Ama@Example.COM ")).toBe("ama@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});

describe("protectIdentifier (spec §41)", () => {
  it("is deterministic for the same pepper, so equality matching works", () => {
    expect(protectIdentifier("+233241234567", PEPPER)).toBe(protectIdentifier("+233241234567", PEPPER));
  });

  it("never returns the raw value, and differs per pepper", () => {
    const hash = protectIdentifier("+233241234567", PEPPER);
    expect(hash).not.toContain("233241234567");
    expect(hash).not.toBe(protectIdentifier("+233241234567", "different-pepper"));
  });

  it("refuses to run without a pepper, an unpeppered phone hash is reversible", () => {
    expect(() => protectIdentifier("+233241234567", "")).toThrow(/pepper/i);
  });
});

describe("protectIdentifierBatch", () => {
  it("dedupes and caps the batch so an address book can't be dumped", () => {
    const many = Array.from({ length: MAX_CONTACTS_PER_MATCH + 500 }, (_, index) => `+2332400000${index}`);
    expect(protectIdentifierBatch({ identifiers: many, pepper: PEPPER })).toHaveLength(MAX_CONTACTS_PER_MATCH);
    expect(protectIdentifierBatch({ identifiers: ["+1", "+1"], pepper: PEPPER })).toHaveLength(1);
  });
});

describe("bulk invites (spec §44)", () => {
  it("bounds manual invites so matching can't become an SMS spam tool", () => {
    expect(validateBulkInviteCount(0)).toMatch(/Choose who/);
    expect(validateBulkInviteCount(50)).toMatch(/up to 10/);
    expect(validateBulkInviteCount(5)).toBeNull();
  });
});
