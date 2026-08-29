import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Profile owns identity imagery; Linkr projects it.
 *
 * `linkr_photos` existed for exactly one reason -- Linkr collected its own
 * uploads during activation -- so it was a duplicate answer to "what does this
 * person look like", and it would drift the first time somebody changed their
 * avatar. It is gone, replaced by a read-only projection over the canonical
 * `profiles.avatar_url` (with a legacy media fallback) + `profile_photos`.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Comments are stripped before asserting a table is unreferenced: these files
 * legitimately explain WHY `linkr_photos` was retired, and that prose is not
 * a query.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const projection = read("lib/linkr/media-projection.ts");
const migration = read("supabase/migrations/20260819120000_profile_owns_identity.sql");
const candidate = read("lib/linkr/candidate-service.ts");
const service = read("lib/linkr/profile-service.ts");
const connection = read("lib/linkr/connection-service.ts");
const actions = read("app/(app)/linkr-actions.ts");

describe("no duplicate Linkr media storage", () => {
  it("reads canonical Profile media, never a Linkr photo table", () => {
    expect(projection).toContain('from("profiles")');
    expect(projection).toContain('from("profile_photos")');
    expect(stripComments(projection)).not.toContain("linkr_photos");
  });

  it("has removed every linkr_photos reader", () => {
    for (const source of [candidate, service, connection, actions]) {
      expect(stripComments(source)).not.toContain("linkr_photos");
    }
  });

  it("drops the table only AFTER backfilling into Profile", () => {
    // Order matters: dropping first would strand every photo uploaded through
    // the old Linkr flow.
    const primaryBackfill = migration.indexOf("update public.profiles p");
    const showcaseBackfill = migration.indexOf("insert into public.profile_photos");
    const drop = migration.indexOf("drop table if exists public.linkr_photos");
    expect(primaryBackfill).toBeGreaterThan(-1);
    expect(showcaseBackfill).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(showcaseBackfill);
    expect(drop).toBeGreaterThan(primaryBackfill);
  });

  it("never overwrites an existing profile picture during backfill", () => {
    // Somebody's avatar is the face the whole product shows; a Linkr photo
    // must not silently replace it.
    expect(migration).toMatch(/set profile_media_id = lp\.media_asset_id[\s\S]{0,200}profile_media_id is null/);
  });

  it("never displaces an existing Profile showcase photo", () => {
    expect(migration).toMatch(/not exists \([\s\S]{0,200}pp\.position = lp\.position - 1/);
  });

  it("moves references, not image bytes", () => {
    // Both backfills carry media_asset_id across; nothing is re-uploaded.
    expect(migration).toContain("lp.media_asset_id");
    expect(migration).not.toMatch(/storage\.|copy .*object/i);
  });
});

describe("the projection is stranger-safe", () => {
  it("admits ONLY photos marked visible to everyone", () => {
    /**
     * profile_photos carries a per-photo visibility chosen for people who
     * already know you. A Linkr candidate is a stranger, so a photo kept for
     * Muddies must not be handed to them because Linkr was switched on.
     */
    expect(projection).toContain('const STRANGER_SAFE = "everyone"');
    expect(projection).toMatch(/\.eq\("visibility", STRANGER_SAFE\)/);
  });

  it("puts the profile picture first, always", () => {
    expect(projection).toContain("const avatarUrl = canonicalAvatarUrl(profile.user_id, profile.avatar_url)");
    expect(projection).toContain("primaryUrl: avatarUrl");
    expect(projection).toContain("primaryAssetId: avatarUrl ? null");
    // A stray showcase cannot become somebody's primary image.
    expect(projection).toMatch(/if \(!media \|\| \(!media\.primaryUrl && !media\.primaryAssetId\)\) continue;/);
  });

  it("caps the gallery at four", () => {
    /* The constant now lives in lib/linkr/media-projection-limits.ts -- a
       client-safe module -- because the candidate card needs the same number
       and cannot import this `server-only` file. Two copies of one number is
       exactly how the card came to clamp at three while this assembled four,
       so the value is asserted where it is DEFINED, and this file is checked
       to re-export rather than redefine it. */
    const limits = read("lib/linkr/media-projection-limits.ts");
    expect(limits).toContain("MAX_LINKR_CARD_PHOTOS = 4");
    expect(projection).toContain("MAX_LINKR_CARD_PHOTOS");
    expect(projection, "the projection redefined a constant it should import").not.toMatch(
      /MAX_LINKR_CARD_PHOTOS\s*=\s*\d/
    );
    expect(projection).toMatch(/showcaseAssetIds\.length >= MAX_LINKR_CARD_PHOTOS - 1/);
  });

  it("orders showcases by their Profile slot", () => {
    expect(projection).toMatch(/\.order\("position", \{ ascending: true \}\)/);
  });

  it("is batched, so the candidate page costs no per-person lookup", () => {
    expect(projection).toMatch(/loadLinkrMedia\([\s\S]{0,120}userIds: string\[\]/);
    expect(projection).toMatch(/\.in\("user_id", userIds\)/);
    expect(candidate).toContain("loadLinkrMedia(admin, candidateIds)");
  });
});

describe("having a photo means having a PROFILE picture", () => {
  it("derives eligibility from the projection rather than a Linkr rule", () => {
    // Index 0 exists only when the person has a profile picture, so "has a
    // photo" has one definition rather than two.
    expect(candidate).toContain("const hasPrimaryPhoto = Boolean(media?.primaryUrl || media?.primaryAssetId)");
  });

  it("reads the canonical profile picture for the check", () => {
    expect(projection).toMatch(/hasProfilePicture[\s\S]{0,260}avatar_url, profile_media_id/);
    expect(projection).toContain("canonicalAvatarUrl(userId, data?.avatar_url ?? null)");
  });

  it("refuses an owner-written cross-origin avatar URL", () => {
    expect(projection).toContain("source.origin === storageOrigin");
    expect(projection).toContain("/storage/v1/object/public/avatars/${userId}/");
    expect(projection).toContain("canonicalAvatarUrl(userId, data?.avatar_url ?? null)");
  });
});

describe("one self-serve DOB correction", () => {
  it("adds the budget column to the canonical table", () => {
    expect(migration).toContain("alter table public.profile_birth_details");
    expect(migration).toContain("correction_used_at timestamptz");
  });

  it("documents that NULL means still available", () => {
    expect(migration).toMatch(/NULL = still available/);
  });
});
