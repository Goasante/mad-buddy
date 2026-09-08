import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "lib/admin/support-owned-diagnostics.server.ts"), "utf8");
const selectColumns = [...source.matchAll(/\.select\("([^"]+)"/g)].flatMap((match) => match[1]!.split(",").map((part) => part.trim()));

describe("support-owned live diagnostic privacy boundary", () => {
  it("never selects location coordinates, private media ids or push credentials", () => {
    for (const forbidden of [
      "latitude",
      "longitude",
      "media_asset_id",
      "endpoint",
      "p256dh",
      "auth",
      "token",
      "destination_type",
      "destination_label",
      "destination_event_id",
      "note"
    ]) {
      expect(selectColumns).not.toContain(forbidden);
    }
  });

  it("uses the canonical age and presence derivation helpers rather than inventing thresholds", () => {
    expect(source).toContain("validateDateOfBirth");
    expect(source).toContain("calculateAge");
    expect(source).toContain("presenceStateFor");
    expect(source).not.toMatch(/PRESENCE_(?:FRESH|GRACE)_MS\s*[+\-*\/]/);
  });

  it("reduces raw DOB, restriction time and presence time before returning the snapshot", () => {
    const returnedSnapshot = source.slice(source.lastIndexOf("  return {"));
    expect(returnedSnapshot).not.toContain("date_of_birth");
    expect(returnedSnapshot).not.toContain("last_updated");
    expect(returnedSnapshot).not.toContain("ends_at");
  });

  it("does not invent an age-based stale push-token rule", () => {
    expect(source).toMatch(/stalePushDevices:\s*0/);
    expect(source).toContain("There is no canonical age-based \"stale push token\" threshold");
  });
});
