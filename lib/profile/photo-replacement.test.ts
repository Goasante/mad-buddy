import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const action = readFileSync("app/(app)/profile-photo-actions.ts", "utf8");
const carousel = readFileSync("components/profile/profile-photo-carousel.tsx", "utf8");

describe("showcase photo replacement", () => {
  it("verifies the replacement belongs to the authenticated owner", () => {
    expect(action).toContain('find((row) => row.id === replacementId.data)');
    expect(action).toContain('.eq("user_id", userId)');
  });

  it("uploads the new asset before swapping the canonical slot", () => {
    const ready = action.indexOf('processing_status: "ready"');
    const swap = action.indexOf('.update({ media_asset_id: asset.id');
    const retire = action.indexOf('.update({ deleted_at: new Date().toISOString() })');
    expect(ready).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(ready);
    expect(retire).toBeGreaterThan(swap);
  });

  it("keeps a preview and explicit confirmation before replacement", () => {
    expect(carousel).toContain("chooseReplacement");
    expect(carousel).toContain("URL.createObjectURL(file)");
    expect(carousel).toContain('replacePhotoId: photoId');
    expect(carousel).toContain('"Replace photo"');
  });
});
