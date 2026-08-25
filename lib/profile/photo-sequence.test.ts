import { describe, expect, it } from "vitest";

import {
  profileViewerSequence,
  showcaseIndexInSequence,
  rotatePhotosToTapped,
  profilePhotoAltText
} from "@/lib/profile/photo-labels";
import { visiblePhotosFor, type ProfilePhoto } from "@/lib/profile/profile-photos";

/**
 * The identity photo and the showcases as ONE viewable gallery.
 *
 * Behaviour, not source text: what the viewer is handed, in what order, and
 * which position a given tap opens on. The privacy cases matter most -- the
 * sequence must never widen what the Profile already authorised.
 */

const showcase = (id: string, position: number, extra: Partial<ProfilePhoto> = {}): ProfilePhoto => ({
  id,
  position,
  url: `https://example.test/${id}.jpg`,
  visibility: "everyone",
  ...extra
});

const AVATAR = "https://example.test/avatar.jpg";

describe("the avatar leads the sequence", () => {
  it("puts the identity photo first, then showcases in order", () => {
    const sequence = profileViewerSequence(AVATAR, [
      showcase("s2", 1),
      showcase("s1", 0),
      showcase("s3", 2)
    ]);
    expect(sequence.map((p) => p.url)).toEqual([
      AVATAR,
      "https://example.test/s1.jpg",
      "https://example.test/s2.jpg",
      "https://example.test/s3.jpg"
    ]);
  });

  it("numbers positions contiguously from zero", () => {
    const sequence = profileViewerSequence(AVATAR, [showcase("s1", 0), showcase("s2", 1)]);
    expect(sequence.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("gives a four-photo Profile a four-item gallery", () => {
    const sequence = profileViewerSequence(AVATAR, [
      showcase("s1", 0),
      showcase("s2", 1),
      showcase("s3", 2)
    ]);
    expect(sequence).toHaveLength(4);
    expect(profilePhotoAltText("Ama", false, 1, sequence.length)).toBe("Photo 1 of 4 of Ama");
  });

  it("handles avatar-only", () => {
    const sequence = profileViewerSequence(AVATAR, []);
    expect(sequence).toHaveLength(1);
    expect(sequence[0]!.url).toBe(AVATAR);
    // One photo drops the position from the label entirely.
    expect(profilePhotoAltText("Ama", true, 1, 1)).toBe("Your photo");
  });

  it("handles avatar plus one showcase", () => {
    expect(profileViewerSequence(AVATAR, [showcase("s1", 0)])).toHaveLength(2);
  });

  it("falls back to showcases alone when there is no avatar", () => {
    const sequence = profileViewerSequence(null, [showcase("s1", 0), showcase("s2", 1)]);
    expect(sequence).toHaveLength(2);
    expect(sequence[0]!.url).toBe("https://example.test/s1.jpg");
  });

  it("is empty when there is nothing to show", () => {
    expect(profileViewerSequence(null, [])).toEqual([]);
  });

  it("gives the avatar an id that cannot collide with a real photo row", () => {
    const [first] = profileViewerSequence(AVATAR, [showcase("s1", 0)]);
    expect(first!.id).toContain(":");
    expect(first!.id).not.toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("a tap opens on the photo that was tapped", () => {
  it("offsets showcase taps past the avatar", () => {
    // Showcase 0 is the second thing in the gallery once the avatar leads.
    expect(showcaseIndexInSequence(true, 0)).toBe(1);
    expect(showcaseIndexInSequence(true, 2)).toBe(3);
  });

  it("does not offset when there is no avatar", () => {
    expect(showcaseIndexInSequence(false, 0)).toBe(0);
    expect(showcaseIndexInSequence(false, 2)).toBe(2);
  });

  it("tapping showcase 2 really opens showcase 2", () => {
    const sequence = profileViewerSequence(AVATAR, [
      showcase("s1", 0),
      showcase("s2", 1),
      showcase("s3", 2)
    ]);
    const index = showcaseIndexInSequence(true, 1);
    const rotated = rotatePhotosToTapped(sequence, index);
    expect(rotated[0]!.url).toBe("https://example.test/s2.jpg");
    // And the rest of the gallery is still reachable from there.
    expect(rotated).toHaveLength(4);
  });

  it("tapping the avatar opens at position 1", () => {
    const sequence = profileViewerSequence(AVATAR, [showcase("s1", 0)]);
    expect(rotatePhotosToTapped(sequence, 0)[0]!.url).toBe(AVATAR);
  });
});

describe("the sequence never widens what the Profile authorised", () => {
  const all = [
    showcase("public", 0, { visibility: "everyone" }),
    showcase("muddies", 1, { visibility: "approved_muddies" }),
    showcase("private", 2, { visibility: "only_me" })
  ];

  it("a stranger's gallery is the avatar plus public photos only", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: false });
    const ids = profileViewerSequence(AVATAR, visible).map((p) => p.id);
    expect(ids).toEqual(["avatar:identity", "public"]);
    expect(ids).not.toContain("muddies");
    expect(ids).not.toContain("private");
  });

  it("an approved muddy still never gets the owner's private photo", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: true });
    const ids = profileViewerSequence(AVATAR, visible).map((p) => p.id);
    expect(ids).toEqual(["avatar:identity", "public", "muddies"]);
    expect(ids).not.toContain("private");
  });

  it("the owner sees their own, including the private one", () => {
    const visible = visiblePhotosFor(all, { isOwner: true, isApprovedMuddy: false });
    expect(profileViewerSequence(AVATAR, visible)).toHaveLength(4);
  });

  it("cannot invent a photo that was not handed to it", () => {
    const visible = visiblePhotosFor(all, { isOwner: false, isApprovedMuddy: false });
    // Avatar + exactly the authorised showcases, never more.
    expect(profileViewerSequence(AVATAR, visible)).toHaveLength(visible.length + 1);
  });
});
