import { describe, expect, it } from "vitest";
import { readVapidConfiguration } from "@/lib/notifications/vapid";

const configured = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
  VAPID_SUBJECT: "mailto:privacy@example.com"
};

describe("VAPID configuration", () => {
  it("accepts matching public keys and a valid subject", () => {
    expect(readVapidConfiguration(configured)).toEqual({
      ok: true,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:privacy@example.com"
    });
  });

  it("reports names, never secret values", () => {
    expect(readVapidConfiguration({})).toEqual({
      ok: false,
      missing: [
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "VAPID_SUBJECT"
      ],
      mismatch: false
    });
  });

  it("rejects mismatched public keys and an invalid subject", () => {
    expect(readVapidConfiguration({ ...configured, VAPID_PUBLIC_KEY: "other" })).toMatchObject({
      ok: false,
      mismatch: true
    });
    expect(readVapidConfiguration({ ...configured, VAPID_SUBJECT: "plain email" })).toMatchObject({
      ok: false
    });
  });
});
