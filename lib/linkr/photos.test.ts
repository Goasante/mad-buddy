import { describe, expect, it } from "vitest";

import {
  MAX_LINKR_PHOTOS,
  PRIMARY_SLOT,
  compactAfterRemoval,
  nextLinkrPhotoSlot,
  nextPhotoIndex,
  orderedPhotos,
  previousPhotoIndex,
  primaryPhoto,
  promoteToPrimary,
  reorderPhotos,
  tapZone,
  type LinkrPhoto
} from "@/lib/linkr/photos";

const photo = (id: string, position: number): LinkrPhoto => ({
  id,
  position,
  url: `https://example.test/${id}.jpg`
});

const four = [photo("a", 0), photo("b", 1), photo("c", 2), photo("d", 3)];

describe("photo ordering", () => {
  it("orders by position regardless of input order", () => {
    const shuffled = [photo("c", 2), photo("a", 0), photo("d", 3), photo("b", 1)];
    expect(orderedPhotos(shuffled).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate its input", () => {
    const input = [photo("c", 2), photo("a", 0)];
    const snapshot = input.map((p) => p.id);
    orderedPhotos(input);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });

  it("identifies the primary photo as the one in slot 0", () => {
    expect(primaryPhoto(four)?.id).toBe("a");
    expect(primaryPhoto([photo("x", 1)])).toBeNull();
    expect(PRIMARY_SLOT).toBe(0);
  });
});

describe("photo slots", () => {
  it("caps the gallery at four", () => {
    expect(MAX_LINKR_PHOTOS).toBe(4);
    expect(nextLinkrPhotoSlot(four)).toBeNull();
  });

  it("returns the lowest free slot", () => {
    expect(nextLinkrPhotoSlot([])).toBe(0);
    expect(nextLinkrPhotoSlot([photo("a", 0)])).toBe(1);
  });

  it("reuses a gap rather than appending past it", () => {
    // Deleting the middle photo then adding another must fill the hole, not
    // leave a gap the carousel has to reason about.
    expect(nextLinkrPhotoSlot([photo("a", 0), photo("c", 2)])).toBe(1);
  });
});

describe("promoting a photo to primary", () => {
  it("SWAPS rather than shuffling everything", () => {
    // Promoting showcase 2 sends the old main photo to slot 2. The other
    // photos keep the positions their owner chose.
    const moves = promoteToPrimary(four, "c");
    expect(moves).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 2 }
    ]);
  });

  it("is a no-op when the photo is already primary", () => {
    expect(promoteToPrimary(four, "a")).toEqual([]);
  });

  it("refuses an unknown photo id", () => {
    // A valid-looking id from somewhere else must not move anybody's photos.
    expect(promoteToPrimary(four, "not-mine")).toBeNull();
  });

  it("promotes into an empty primary slot without a swap partner", () => {
    const moves = promoteToPrimary([photo("b", 1)], "b");
    expect(moves).toEqual([{ id: "b", position: 0 }]);
  });

  it("results in exactly one primary", () => {
    const moves = promoteToPrimary(four, "d") ?? [];
    const after = four.map((p) => {
      const move = moves.find((m) => m.id === p.id);
      return move ? { ...p, position: move.position } : p;
    });
    expect(after.filter((p) => p.position === PRIMARY_SLOT)).toHaveLength(1);
    expect(new Set(after.map((p) => p.position)).size).toBe(after.length);
  });
});

describe("removing a photo", () => {
  it("closes the gap so slots stay 0..n-1", () => {
    const moves = compactAfterRemoval(four, "b");
    const after = four
      .filter((p) => p.id !== "b")
      .map((p) => {
        const move = moves.find((m) => m.id === p.id);
        return move ? move.position : p.position;
      });
    expect(after.sort()).toEqual([0, 1, 2]);
  });

  it("promotes the next photo when the primary is removed", () => {
    // Otherwise the card's first photo would sit in slot 1 with no primary,
    // a state everything downstream would have to special-case forever.
    const moves = compactAfterRemoval(four, "a");
    expect(moves).toContainEqual({ id: "b", position: 0 });
  });

  it("emits no moves when the last photo is removed", () => {
    expect(compactAfterRemoval(four, "d")).toEqual([]);
  });
});

describe("reordering", () => {
  it("assigns positions in the given order", () => {
    expect(reorderPhotos(four, ["d", "c", "b", "a"])).toEqual([
      { id: "d", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
      { id: "a", position: 3 }
    ]);
  });

  it("ignores ids that are not the caller's photos", () => {
    expect(reorderPhotos(four, ["d", "someone-elses", "a"])).toEqual([
      { id: "d", position: 0 },
      { id: "a", position: 1 }
    ]);
  });

  it("never assigns a position beyond the gallery size", () => {
    const moves = reorderPhotos(four, ["a", "b", "c", "d", "a", "b"]);
    expect(moves.every((move) => move.position < MAX_LINKR_PHOTOS)).toBe(true);
  });
});

describe("photo navigation inside a card", () => {
  it("advances and goes back", () => {
    expect(nextPhotoIndex(0, 3)).toBe(1);
    expect(nextPhotoIndex(1, 3)).toBe(2);
    expect(previousPhotoIndex(2)).toBe(1);
    expect(previousPhotoIndex(1)).toBe(0);
  });

  it("CLAMPS rather than wrapping", () => {
    // Wrapping from the last photo to the first reads as a dismissal, which
    // is the one misreading this gesture cannot afford: a horizontal swipe on
    // the same surface decides about the person.
    expect(nextPhotoIndex(2, 3)).toBe(2);
    expect(previousPhotoIndex(0)).toBe(0);
  });

  it("survives an empty gallery", () => {
    expect(nextPhotoIndex(0, 0)).toBe(0);
  });

  it("gives Back the left third and Next the rest", () => {
    expect(tapZone(10, 300)).toBe("previous");
    expect(tapZone(99, 300)).toBe("previous");
    expect(tapZone(101, 300)).toBe("next");
    expect(tapZone(290, 300)).toBe("next");
  });

  it("defaults to Next on a zero-width card", () => {
    expect(tapZone(0, 0)).toBe("next");
  });
});

describe("photo mutation tests", () => {
  it("BITES: promoting without moving the old primary out of slot 0", () => {
    const moves = promoteToPrimary(four, "c") ?? [];
    // Two photos in slot 0 would violate the unique constraint and, worse,
    // make "which photo is the card" ambiguous.
    expect(moves.filter((m) => m.position === PRIMARY_SLOT)).toHaveLength(1);
    expect(moves.some((m) => m.id === "a")).toBe(true);
  });

  it("BITES: removal that leaves the gallery without a primary", () => {
    const moves = compactAfterRemoval(four, "a");
    const remaining = four.filter((p) => p.id !== "a");
    const after = remaining.map((p) => moves.find((m) => m.id === p.id)?.position ?? p.position);
    expect(after).toContain(PRIMARY_SLOT);
  });

  it("BITES: navigation that wraps around the ends", () => {
    expect(nextPhotoIndex(2, 3)).not.toBe(0);
    expect(previousPhotoIndex(0)).not.toBe(2);
  });
});
