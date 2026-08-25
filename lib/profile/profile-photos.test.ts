import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAX_PROFILE_PHOTOS,
  PHOTO_VISIBILITY_OPTIONS,
  canAddPhoto,
  nextPhotoSlot,
  visiblePhotosFor,
  type ProfilePhoto
} from "@/lib/profile/profile-photos";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260808220000_trusted_member_and_photos.sql");

const photo = (overrides: Partial<ProfilePhoto> = {}): ProfilePhoto => ({
  id: "photo-1",
  position: 0,
  url: "https://example.test/a.jpg",
  visibility: "everyone",
  ...overrides
});

describe("who sees which photo", () => {
  const gallery = [
    photo({ id: "public", position: 0, visibility: "everyone" }),
    photo({ id: "muddies", position: 1, visibility: "approved_muddies" }),
    photo({ id: "private", position: 2, visibility: "only_me" })
  ];

  it("shows the owner everything, including their private photo", () => {
    // A photo you cannot see is a photo you cannot manage.
    const seen = visiblePhotosFor(gallery, { isOwner: true, isApprovedMuddy: false });
    expect(seen.map((p) => p.id)).toEqual(["public", "muddies", "private"]);
  });

  it("shows a Muddy the public and Muddies photos, never only_me", () => {
    const seen = visiblePhotosFor(gallery, { isOwner: false, isApprovedMuddy: true });
    expect(seen.map((p) => p.id)).toEqual(["public", "muddies"]);
  });

  it("shows a stranger the public photo only", () => {
    const seen = visiblePhotosFor(gallery, { isOwner: false, isApprovedMuddy: false });
    expect(seen.map((p) => p.id)).toEqual(["public"]);
  });

  it("hides an unrecognised visibility rather than defaulting to public", () => {
    // A future option, or a stale row, must fail closed.
    const rogue = [photo({ id: "rogue", visibility: "something_new" as never })];
    expect(visiblePhotosFor(rogue, { isOwner: false, isApprovedMuddy: true })).toHaveLength(0);
  });

  it("never mutates the gallery it was given", () => {
    const original = [...gallery];
    visiblePhotosFor(gallery, { isOwner: true, isApprovedMuddy: false });
    expect(gallery).toEqual(original);
  });
});

describe("the gallery is capped at three", () => {
  it("offers three slots beyond the avatar", () => {
    expect(MAX_PROFILE_PHOTOS).toBe(3);
  });

  it("fills the lowest free slot rather than appending", () => {
    // Deleting the middle photo and adding another reuses the gap instead of
    // leaving a hole the carousel would have to reason about.
    const withGap = [photo({ position: 0 }), photo({ id: "third", position: 2 })];
    expect(nextPhotoSlot(withGap)).toBe(1);
  });

  it("reports full when every slot is taken", () => {
    const full = [photo({ position: 0 }), photo({ id: "b", position: 1 }), photo({ id: "c", position: 2 })];
    expect(nextPhotoSlot(full)).toBeNull();
    expect(canAddPhoto(full)).toBe(false);
  });

  it("enforces the cap in the schema, not only in code", () => {
    // Application code can forget; a constraint cannot.
    expect(migration).toContain("position integer not null check (position between 0 and 2)");
    expect(migration).toContain("unique (user_id, position)");
  });
});

describe("visibility reuses the existing vocabulary", () => {
  it("offers exactly three audiences", () => {
    expect(PHOTO_VISIBILITY_OPTIONS.map((option) => option.id)).toEqual([
      "everyone",
      "approved_muddies",
      "only_me"
    ]);
  });

  it("defaults a new photo to Muddies rather than everyone", () => {
    // The safer answer, chosen for someone who never opens the setting.
    expect(migration).toContain("visibility text not null default 'approved_muddies'");
  });
});

describe("RLS grants only the unambiguous case", () => {
  it("lets any signed-in user read an everyone photo", () => {
    expect(migration).toContain("visibility = 'everyone'");
    expect(migration).toContain("auth.uid() is not null");
  });

  it("does not try to express Muddies-only in a policy", () => {
    // That needs the friendship join plus block and ghost checks that already
    // live in the server loader. A second, drifting copy is how the two
    // disagree.
    const policy = migration.slice(migration.indexOf('create policy "public photos readable"'));
    expect(policy.slice(0, 400)).not.toContain("friendships");
  });

  it("keeps the owner in full control of their own rows", () => {
    expect(migration).toContain('create policy "own photos manageable"');
  });
});

describe("the avatar is left alone", () => {
  it("adds no column to profiles for the gallery", () => {
    // The avatar is the identity everywhere in the product; folding it in
    // would make every avatar read a second table.
    const photosBlock = migration.slice(migration.indexOf("create table if not exists public.profile_photos"));
    expect(photosBlock).not.toContain("avatar_url");
  });
});

describe("the carousel", () => {
  const carousel = read("components/profile/profile-photo-carousel.tsx");
  const actions = read("app/(app)/profile-photo-actions.ts");

  it("is one component for viewing and managing", () => {
    // The owner must see exactly what a visitor sees while managing it; a
    // separate edit screen would let the two drift.
    expect(carousel).toContain("isOwner");
    expect(carousel).toContain("PHOTO_VISIBILITY_OPTIONS.map");
  });

  it("puts visibility on the photo it governs", () => {
    // "Who can see this one?" is harder to check than to change if the answer
    // lives in a settings list somewhere else.
    expect(carousel).toContain("setVisibility(current.id, option.id)");
  });

  it("renders nothing to a visitor with no visible photos", () => {
    // An empty frame would imply something was hidden from them.
    expect(carousel).toContain("if (count === 0 && !isOwner) return null;");
  });

  it("clamps the index during render, so deleting the last photo is safe", () => {
    expect(carousel).toContain("Math.min(index, count - 1)");
  });

  it("hides the arrows when there is nowhere to go", () => {
    expect(carousel).toContain("count > 1 ?");
  });

  it("announces position politely for screen readers", () => {
    expect(carousel).toContain('aria-live="polite"');
    expect(carousel).toContain("Photo {active + 1} of {count}");
  });

  it("compresses before upload so a phone photo is not rejected on size", () => {
    expect(carousel).toContain("compressImageForUpload");
  });

  it("strips EXIF before anything reaches storage", () => {
    // A profile photo often carries GPS from where it was taken.
    expect(actions).toContain("processImageUpload");
  });

  it("chooses the slot server-side, never from the client", () => {
    // A client-supplied position could overwrite a photo or exceed the cap.
    expect(actions).toContain("const slot = nextPhotoSlot(");
    expect(actions).not.toContain("formData.get(\"position\")");
  });

  it("scopes every mutation to the caller's own rows", () => {
    const visibility = actions.slice(actions.indexOf("setProfilePhotoVisibilityAction"));
    expect(visibility).toContain('.eq("user_id", userId)');
    const remove = actions.slice(actions.indexOf("deleteProfilePhotoAction"));
    expect(remove).toContain('.eq("user_id", userId)');
  });

  it("never renders the avatar inside the EDITABLE gallery", () => {
    // It is the identity used across the product; mixing them would make
    // "delete this photo" ambiguous.
    //
    // The avatar IS now allowed into the read-only full-screen sequence, so
    // that tapping it opens "1 of 4" rather than a second gallery of its own.
    // A bare "does the file mention avatarUrl" scan can no longer tell those
    // two apart, so this asserts the thing that actually matters: every
    // managed photo -- the one on screen, the dots, and everything the
    // mutation controls act on -- still comes from `photos`, never the avatar.
    // The RENDER region: from the returned markup to the full-screen viewer.
    // The avatar is legitimately named above this (a prop) and below it (the
    // read-only sequence); what must stay avatar-free is everything the person
    // can act on.
    const managed = carousel.slice(
      carousel.indexOf("<section aria-labelledby=\"profile-photos-heading\""),
      carousel.indexOf("<ProfilePhotoViewer")
    );
    expect(managed.length).toBeGreaterThan(0);
    expect(carousel).toContain("const current = photos[active]");
    expect(managed).not.toContain("avatarUrl");

    // And the mutations still address a real photo row by id.
    expect(carousel).toContain("await deleteProfilePhotoAction({ photoId })");
    expect(carousel).toContain("await setProfilePhotoVisibilityAction({ photoId, visibility })");
  });
});

describe("gallery privacy is proved server-side", () => {
  const service = read("lib/profile/photo-service.ts");
  const publicLoader = read("lib/profile/public.ts");
  const muddyRoute = read("app/(app)/friends/[username]/page.tsx");
  const ownRoute = read("app/(app)/profile/page.tsx");

  it("filters in the WHERE clause, never after the fetch", () => {
    // An only_me photo is not read into memory and then discarded; the query
    // never selects it for anyone but its owner.
    expect(service).toContain('query.in("visibility", ["everyone", "approved_muddies"])');
    expect(service).toContain('query.eq("visibility", "everyone")');
  });

  it("gives the owner everything, including only_me", () => {
    expect(service).toContain("if (!viewer.isOwner) {");
    expect(ownRoute).toContain("{ isOwner: true, isApprovedMuddy: false }");
  });

  it("treats an ended Muddy as a stranger without a second check", () => {
    // areApprovedMuddies already requires ended_at IS NULL, so the ended case
    // falls into the stranger branch on its own. A separate check could
    // disagree with the first.
    expect(muddyRoute).toContain("isApprovedMuddy: areFriends");
    expect(service).toContain("requires ended_at IS NULL");
  });

  it("refuses the whole profile to a blocked viewer, gallery included", () => {
    // Blocking is resolved before the gallery is ever reached, so there is no
    // "profile with an empty gallery" state for a blocked viewer.
    expect(publicLoader).toContain("isBlockedEitherDirection(admin, viewerId, targetId)) return null");
    expect(muddyRoute).toContain("isBlockedEitherDirection(admin, user.id, profile.user_id)");
  });

  it("is one loader, not a copy per surface", () => {
    // Two copies is how two surfaces end up disagreeing, and the
    // disagreement always resolves toward the more permissive one.
    expect(publicLoader).toContain("loadVisibleProfilePhotosFor(admin, targetId");
    expect(muddyRoute).toContain("loadVisibleProfilePhotosFor(admin, profile.user_id");
  });

  it("never filters photos on the client", () => {
    const carousel = read("components/profile/profile-photo-carousel.tsx");
    expect(carousel).not.toContain("visiblePhotosFor(");
    expect(carousel).toContain("Already filtered by the server");
  });
});

describe("gallery performance", () => {
  const service = read("lib/profile/photo-service.ts");
  const ownRoute = read("app/(app)/profile/page.tsx");

  it("signs thumbnails only, never full images up front", () => {
    // Three photos would otherwise mint three full-resolution URLs nobody
    // may open.
    expect(service).toContain('signMediaForAsset(admin, row.media_asset_id, "thumb")');
    expect(service).not.toContain('"full"');
  });

  it("mints signed, expiring URLs rather than permanent ones", () => {
    // A permanent URL outlives the setting that allowed it, so switching a
    // photo to only_me could not take back a link already handed out.
    expect(service).toContain("Signed and short-lived");
  });

  it("loads the gallery in the route's existing parallel batch", () => {
    expect(ownRoute).toContain("loadVisibleProfilePhotosFor(admin, user.id");
    const batch = ownRoute.slice(ownRoute.indexOf("await Promise.all(["));
    expect(batch.slice(0, 900)).toContain("loadVisibleProfilePhotosFor");
  });
});
