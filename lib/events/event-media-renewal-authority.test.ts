import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const renewal = stripComments(read("app/(app)/event-media-actions.ts"));

describe("Event cover renewal authority", () => {
  it("requires a current server-backed user and canonical Event access", () => {
    expect(renewal).toContain("getCurrentUserRecord");
    expect(renewal).toContain("getEventForViewer");
  });

  it("fails closed when block authority cannot be read", () => {
    expect(renewal).toContain('from("blocked_users")');
    expect(renewal).toContain("blockError || blocks?.length");
  });

  it("checks the block authority before minting a fresh signed URL", () => {
    const blockRead = renewal.indexOf('from("blocked_users")');
    const signer = renewal.indexOf("signMediaForAsset");
    expect(blockRead).toBeGreaterThan(-1);
    expect(signer).toBeGreaterThan(blockRead);
  });

  it("does not make the private media bucket public", () => {
    expect(renewal).not.toContain("getPublicUrl");
    expect(renewal).not.toContain("publicUrl");
  });
});
