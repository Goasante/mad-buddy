import { describe, expect, it } from "vitest";

import { profilePhotoAltText, rotatePhotosToTapped } from "@/lib/profile/photo-labels";
import { visiblePhotosFor, type ProfilePhoto } from "@/lib/profile/profile-photos";

/**
 * Tapping a Profile photo opens it full screen.
 *
 * These assert BEHAVIOUR, not source text: what the viewer is handed, in what
 * order, and under what accessible name. The privacy case is the important
 * one -- full screen must be able to show exactly what the Profile already
 * showed, and nothing more.
 */

const photo = (overrides: Partial<ProfilePhoto> = {}): ProfilePhoto => ({
  id: "photo-1",
  position: 0,
  url: "https://example.test/a.jpg",
  visibility: "everyone",
  ...overrides
});

describe("full screen opens on the photo that was tapped", () => {
  const photos = [
    photo({ id: "a", position: 0, url: "https://example.test/a.jpg" }),
    photo({ id: "b", position: 1, url: "https://example.test/b.jpg" }),
    photo({ id: "c", position: 2, url: "https://example.test/c.jpg" })
  ];

  it("leads with the tapped photo", () => {
    expect(rotatePhotosToTapped(photos, 2).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(rotatePhotosToTapped(photos, 0).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the Profile's own order for next/previous", () => {
    // Stepping on from the tapped photo continues the gallery, wrapping round.
    expect(rotatePhotosToTapped(photos, 1).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("never adds or drops a photo", () => {
    for (let index = 0; index < photos.length; index += 1) {
      const rotated = rotatePhotosToTapped(photos, index);
      expect(rotated).toHaveLength(photos.length);
      expect([...rotated].map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    }
  });

  it("survives an out-of-range or empty input rather than blanking", () => {
    expect(rotatePhotosToTapped(photos, 99).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(rotatePhotosToTapped(photos, -1).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(rotatePhotosToTapped([], 0)).toEqual([]);
  });
});

describe("full screen shows only what the Profile already authorised", () => {
  const all = [
    photo({ id: "public", position: 0, visibility: "everyone" }),
    photo({ id: "muddies", position: 1, visibility: "approved_muddies" }),
    photo({ id: "private", position: 2, visibility: "only_me" })
  ];

  it("a stranger cannot reach a restricted photo through full screen", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: false });
    const inViewer = rotatePhotosToTapped(visible, 0).map((p) => p.id);
    expect(inViewer).toEqual(["public"]);
    expect(inViewer).not.toContain("only_me");
    expect(inViewer).not.toContain("private");
  });

  it("an approved muddy sees theirs, still never the owner's private photo", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: true });
    const inViewer = rotatePhotosToTapped(visible, 0).map((p) => p.id);
    expect(inViewer).toEqual(["public", "muddies"]);
    expect(inViewer).not.toContain("private");
  });

  it("the owner can open their own private photo full screen", () => {
    const visible = visiblePhotosFor(all, { isOwner: true, isApprovedMuddy: false });
    expect(rotatePhotosToTapped(visible, 2).map((p) => p.id)).toEqual([
      "private",
      "public",
      "muddies"
    ]);
  });

  it("rotation cannot widen the set it was given", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: false });
    // Even asking for an index beyond the authorised set yields only that set.
    expect(rotatePhotosToTapped(visible, 5)).toHaveLength(visible.length);
  });
});

describe("the accessible name says whose photo it is, never the filename", () => {
  it("names the owner's own photo without naming them", () => {
    expect(profilePhotoAltText("Ama", true, 1, 3)).toBe("Your photo 1 of 3");
  });

  it("names whose photo a visitor is looking at", () => {
    expect(profilePhotoAltText("Ama", false, 2, 3)).toBe("Photo 2 of 3 of Ama");
  });

  it("drops the position when there is only one photo", () => {
    expect(profilePhotoAltText("Ama", false, 1, 1)).toBe("Photo of Ama");
    expect(profilePhotoAltText("Ama", true, 1, 1)).toBe("Your photo");
  });

  it("never leaks a filename or storage path", () => {
    const label = profilePhotoAltText("Ama", false, 1, 2);
    expect(label).not.toMatch(/\.(jpe?g|png|webp|heic)/i);
    expect(label).not.toContain("/");
    expect(label).not.toContain("http");
  });
});
