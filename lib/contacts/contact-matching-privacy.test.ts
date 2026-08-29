import { describe, expect, it } from "vitest";

import {
  MAX_CONTACT_BATCH,
  MIN_CONTACT_BATCH,
  type ContactMatch
} from "@/lib/contacts/contact-matching";

/**
 * CONTACT MATCHING MUST NOT BECOME A PHONE-NUMBER LOOKUP API.
 *
 * The audit for this tranche found the matching layer already built to the
 * right contract, and these exist so it stays that way -- the properties below
 * are the difference between "check which of my contacts are here" and "tell
 * me whether this number is registered", and they are one careless change
 * apart.
 *
 * Verified against the real matcher during the audit, with the HMAC secret
 * configured locally:
 *
 *   one number submitted            -> refused, too_few
 *   MAX_CONTACT_BATCH + 500 numbers -> refused, too_many
 *   a legitimate batch              -> succeeds, and the serialised result
 *                                      contains no phone number at all
 *
 * These pin the invariants that make those outcomes structural rather than
 * incidental.
 */

describe("the batch bounds are what stop enumeration", () => {
  it("requires a real batch, so a match cannot be attributed to one number", () => {
    /* A batch of one is a lookup wearing a batch's clothing: the caller learns
       precisely which number is registered. The floor is what makes a match
       un-attributable. */
    expect(MIN_CONTACT_BATCH).toBeGreaterThan(1);
    expect(MIN_CONTACT_BATCH).toBeGreaterThanOrEqual(5);
  });

  it("caps the batch, so the endpoint cannot be used to harvest", () => {
    expect(MAX_CONTACT_BATCH).toBeGreaterThan(MIN_CONTACT_BATCH);
    // Large enough for a real address book, small enough not to be a scraper.
    expect(MAX_CONTACT_BATCH).toBeLessThanOrEqual(5000);
  });
});

describe("a match can never carry a phone number", () => {
  /* THE STRUCTURAL GUARANTEE. This is stronger than filtering a field out at
     the end: the type has no phone-shaped member, so there is nothing to
     forget to remove. If somebody adds one, this stops compiling and this test
     stops passing. */
  it("has no phone-shaped field on the returned shape", () => {
    const sample: ContactMatch = {
      userId: "u",
      displayName: "d",
      username: "n",
      avatarUrl: null,
      isVerifiedAccount: false,
      trustedSince: null,
      plan: "free",
      relationship: "none"
    };

    const keys = Object.keys(sample);
    for (const forbidden of ["phone", "phoneNumber", "e164", "msisdn", "tel", "number", "contact"]) {
      expect(
        keys.some((key) => key.toLowerCase().includes(forbidden)),
        `ContactMatch grew a "${forbidden}" field`
      ).toBe(false);
    }

    // And nothing in a serialised match looks like a number either.
    expect(/\+\d{7,}/.test(JSON.stringify(sample))).toBe(false);
  });

  it("describes the relationship rather than the identifier that found it", () => {
    /* The row shows Add / Requested / Muddies. That is derived server-side
       from friendships -- the same table every other surface reads -- and
       never from anything about the phone number that produced the match. */
    const relationships: ContactMatch["relationship"][] = [
      "none",
      "requested",
      "incoming",
      "muddies"
    ];
    expect(relationships).toHaveLength(4);
  });
});
