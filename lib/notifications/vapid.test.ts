import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("validates production configuration during server startup without logging values", () => {
    const source = readFileSync(join(process.cwd(), "instrumentation.ts"), "utf8");
    expect(source).toContain("startup.web_push_configuration");
    expect(source).toContain("readVapidConfiguration(process.env)");
    expect(source).not.toContain("VAPID_PRIVATE_KEY=");
  });
});
