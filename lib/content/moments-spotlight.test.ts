import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/entitlements";
import {
  isSpotlightAudience,
  isSupportedReaction,
  MOMENT_REACTIONS,
  rankSpotlightMoments,
  resolveMomentVisibility,
  scoreSpotlightMoment,
  summarizeReactions,
  tunedInCountLabel,
  tuneInLabel,
  type SpotlightRankingInput
} from "@/lib/content/moments";
import { PRODUCT_EVENT_NAMES } from "@/lib/analytics/product-analytics";
import type { MomentAudienceType } from "@/lib/supabase/database.types";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Comments removed as SPANS, so JSX comments and block continuations go too. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/**
 * Comments removed from SQL too (`-- ...`). These rules are about code and
 * naming, and the migrations legitimately explain in prose WHY Tune In is not a
 * follower graph and why there is no dislike. Matching that explanation would
 * force the rule to be weakened rather than the code fixed.
 */
const stripSql = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

/** One top-level declaration, anchored to the next export rather than "\n}". */
const declaration = (code: string, signature: string) => {
  const start = code.indexOf(signature);
  if (start === -1) return "";
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
};

const SERVICE = stripComments(read("lib/content/service.ts"));
const ACTIONS = stripComments(read("app/(app)/moments-actions.ts"));
const MIGRATION = read("supabase/migrations/20260731100000_moments_spotlight_tune_in.sql");

const UI_FILES = [
  "components/content/moments-page.tsx",
  "components/content/moment-parts.tsx",
  "components/content/moment-composer.tsx"
];

// ---------------------------------------------------------------------------
// No comments in this phase
// ---------------------------------------------------------------------------

describe("comments are absent, not hidden", () => {
  it("has no comment table, column or migration", () => {
    for (const file of ["20260717140000_moments_drops_media_safety.sql", "20260731100000_moments_spotlight_tune_in.sql"]) {
      const sql = read(`supabase/migrations/${file}`).toLowerCase();
      expect(sql, file).not.toContain("moment_comments");
      expect(sql, file).not.toContain("comment_count");
    }
  });

  it("has no comment action or API", () => {
    expect(ACTIONS.toLowerCase()).not.toContain("comment");
    expect(stripComments(read("app/api/moments/route.ts")).toLowerCase()).not.toContain("comment");
  });

  it("renders no comment control or counter", () => {
    for (const file of UI_FILES) {
      const code = stripComments(read(file)).toLowerCase();
      // MessageCircle/MessageSquare are the icons a comment button would use.
      expect(code, file).not.toContain("comment");
      expect(code, file).not.toContain("messagecircle");
      expect(code, file).not.toContain("messagesquare");
    }
  });

  it("carries no comment field on the feed payload", () => {
    const type = declaration(SERVICE, "export type VisibleMoment");
    expect(type.toLowerCase()).not.toContain("comment");
  });
});

// ---------------------------------------------------------------------------
// Positive reactions only
// ---------------------------------------------------------------------------

describe("reactions are positive only", () => {
  it("offers a compact canonical set", () => {
    expect(MOMENT_REACTIONS.length).toBeGreaterThanOrEqual(4);
    expect(MOMENT_REACTIONS.length).toBeLessThanOrEqual(6);
  });

  it("matches the reaction types the database will actually accept", () => {
    // Adding an emoji here without a migration would fail at insert time, so the
    // set is pinned to the existing check constraint.
    const sql = read("supabase/migrations/20260717140000_moments_drops_media_safety.sql");
    const constraint = /reaction_type text not null check \(reaction_type in \(([^)]+)\)\)/.exec(sql)?.[1] ?? "";
    for (const reaction of MOMENT_REACTIONS) {
      expect(constraint, `${reaction.id} is not in the constraint`).toContain(`'${reaction.id}'`);
    }
  });

  it("contains no negative reaction anywhere", () => {
    const ids = MOMENT_REACTIONS.map((reaction) => reaction.id).join(" ");
    const labels = MOMENT_REACTIONS.map((reaction) => reaction.label.toLowerCase()).join(" ");
    for (const negative of ["dislike", "downvote", "thumbsdown", "thumbs_down", "angry", "sad", "boo"]) {
      expect(ids).not.toContain(negative);
      expect(labels).not.toContain(negative);
    }
    expect(MOMENT_REACTIONS.map((reaction) => reaction.emoji)).not.toContain("👎");
  });

  it("rejects an unsupported reaction id", () => {
    expect(isSupportedReaction("heart")).toBe(true);
    for (const bad of ["dislike", "downvote", "👎", "", "shrug"]) {
      expect(isSupportedReaction(bad)).toBe(false);
    }
  });

  it("validates the reaction server-side against that set", () => {
    expect(ACTIONS).toContain("isSupportedReaction(reaction)");
  });

  it("has no dislike or downvote in the UI or the schema", () => {
    for (const file of [...UI_FILES, "lib/content/moments.ts", "lib/content/service.ts"]) {
      const code = stripComments(read(file)).toLowerCase();
      for (const negative of ["dislike", "downvote", "👎"]) {
        expect(code, `${file} contains ${negative}`).not.toContain(negative);
      }
    }
  });

  it("summarises compactly rather than listing every type", () => {
    const summary = summarizeReactions({ heart: 120, fire: 42, laugh: 18, clap: 3, wave: 1 });
    expect(summary.entries).toHaveLength(3);
    expect(summary.entries[0]).toMatchObject({ id: "heart", count: 120 });
    // The total still counts everything, including what is not displayed.
    expect(summary.total).toBe(184);
  });

  it("ignores unknown reaction ids in a breakdown", () => {
    const summary = summarizeReactions({ heart: 5, dislike: 99 });
    expect(summary.entries.map((entry) => entry.id)).toEqual(["heart"]);
  });

  it("keeps one reaction per user, updating rather than duplicating", () => {
    const sql = read("supabase/migrations/20260717140000_moments_drops_media_safety.sql");
    expect(sql).toContain("constraint moment_reactions_unique unique (moment_id, user_id)");
    const react = declaration(ACTIONS, "export async function reactToMomentAction");
    expect(react).toContain('{ onConflict: "moment_id,user_id" }');
    // A change is reported distinctly from a first reaction.
    expect(react).toContain('existing ? "moment_reaction_changed" : "moment_reacted"');
  });
});

// ---------------------------------------------------------------------------
// Tune In
// ---------------------------------------------------------------------------

describe("Tune In is not a follower graph", () => {
  it("names nothing follower/following", () => {
    for (const file of [
      "supabase/migrations/20260731100000_moments_spotlight_tune_in.sql",
      "lib/content/service.ts",
      "lib/content/moments.ts",
      ...UI_FILES
    ]) {
      const code = stripSql(stripComments(read(file))).toLowerCase();
      for (const banned of ["follower", "following", "unfollow"]) {
        expect(code, `${file} contains ${banned}`).not.toContain(banned);
      }
    }
  });

  it("models viewer, creator and a unique pair", () => {
    expect(MIGRATION).toContain("create table if not exists public.tune_ins");
    expect(MIGRATION).toContain("viewer_id uuid not null");
    expect(MIGRATION).toContain("creator_id uuid not null");
    expect(MIGRATION).toContain("constraint tune_ins_unique unique (viewer_id, creator_id)");
    expect(MIGRATION).toContain("constraint tune_ins_not_self");
  });

  it("attributes a tune-in to the Moment that caused it", () => {
    expect(MIGRATION).toContain("source_moment_id uuid references public.moments(id)");
    expect(ACTIONS).toContain("source_moment_id: attributedSource");
  });

  it("only attributes a source the viewer could actually see", () => {
    const tuneIn = declaration(ACTIONS, "export async function tuneInAction");
    // Otherwise attribution could be forged by posting an arbitrary Moment id.
    expect(tuneIn).toContain("canViewMoment(admin, userId, source)");
  });

  it("never notifies the creator", () => {
    const tuneIn = declaration(ACTIONS, "export async function tuneInAction");
    const tuneOut = declaration(ACTIONS, "export async function tuneOutAction");
    for (const body of [tuneIn, tuneOut]) {
      expect(body).not.toContain("deliverNotification");
      expect(body).not.toContain("createNotification");
    }
  });

  it("exposes only an aggregate count, never a list", () => {
    // The single select policy is scoped to the VIEWER's own rows, so "who tuned
    // in to me" has no readable path from a client at all.
    expect(MIGRATION).toContain('create policy "tune ins owned by viewer" on public.tune_ins');
    expect(MIGRATION).toContain("for all using (auth.uid() = viewer_id)");
    expect(MIGRATION).not.toMatch(/using \(auth\.uid\(\) = creator_id\)/);
    // Counting therefore has to be security definer.
    expect(MIGRATION).toContain("create or replace function public.tune_in_counts");
    expect(MIGRATION).toContain("security definer");
  });

  it("returns only counts from the aggregate functions", () => {
    const counts = MIGRATION.slice(MIGRATION.indexOf("function public.tune_in_counts"));
    const body = counts.slice(0, counts.indexOf("$$;"));
    expect(body).toContain("count(*)");
    // No identity column is selected.
    expect(body).not.toContain("viewer_id,");
    expect(body).not.toMatch(/select t\.viewer_id/);
  });

  it("gives the viewer a private list they alone can read", () => {
    expect(SERVICE).toContain("export async function loadMyTuneIns");
    const loader = declaration(SERVICE, "export async function loadMyTuneIns");
    expect(loader).toContain('.eq("viewer_id", viewerId)');
    expect(loader).not.toContain('.eq("creator_id"');
  });

  it("is reversible with no confirmation and no notification", () => {
    // The management list moved into the dedicated strip module.
    const strip = read("components/content/tuned-in-strip.tsx");
    expect(strip).toContain("Tune Out");
    const modal = declaration(strip, "export function TunedInManageModal");
    expect(modal).not.toContain("Are you sure");
    expect(modal).toContain("onTuneOut(entry.creatorId)");
  });

  it("is independent of reactions in both directions", () => {
    const tuneIn = declaration(ACTIONS, "export async function tuneInAction");
    expect(tuneIn).not.toContain("moment_reactions");
    const react = declaration(ACTIONS, "export async function reactToMomentAction");
    expect(react).not.toContain("tune_ins");
  });

  it("labels the count without follower language", () => {
    expect(tunedInCountLabel(428)).toBe("428 Tuned In");
    expect(tuneInLabel(false)).toBe("Tune In");
    expect(tuneInLabel(true)).toBe("Tuned In");
  });
});

// ---------------------------------------------------------------------------
// Spotlight ranking
// ---------------------------------------------------------------------------

describe("Spotlight ranking blends signals", () => {
  const base: SpotlightRankingInput = {
    momentId: "m",
    createdAtMs: 0,
    tunedIn: false,
    isMuddy: false,
    reactionCount: 0,
    viewCount: 0
  };
  const now = 3_600_000; // one hour in

  it("boosts a tuned-in creator", () => {
    const plain = scoreSpotlightMoment({ ...base, createdAtMs: 0 }, now);
    const tuned = scoreSpotlightMoment({ ...base, createdAtMs: 0, tunedIn: true }, now);
    expect(tuned).toBeGreaterThan(plain);
  });

  it("does NOT let a tuned-in creator's stale Moment beat a fresh new one", () => {
    // Discovery has to survive: this is the difference between a blended feed
    // and a private timeline.
    const staleTuned = scoreSpotlightMoment(
      { ...base, createdAtMs: now - 20 * 3_600_000, tunedIn: true, isMuddy: true },
      now
    );
    const freshStranger = scoreSpotlightMoment({ ...base, createdAtMs: now }, now);
    expect(freshStranger).toBeGreaterThan(staleTuned);
  });

  it("uses engagement RATE, so raw views cannot dominate", () => {
    const wellReceived = scoreSpotlightMoment({ ...base, reactionCount: 40, viewCount: 50 }, now);
    const widelyIgnored = scoreSpotlightMoment({ ...base, reactionCount: 40, viewCount: 100_000 }, now);
    expect(wellReceived).toBeGreaterThan(widelyIgnored);
  });

  it("is deterministic and takes now as a parameter", () => {
    const input = { ...base, createdAtMs: 1000 };
    expect(scoreSpotlightMoment(input, now)).toBe(scoreSpotlightMoment(input, now));
  });

  it("ranks a page without mutating the input", () => {
    const moments = [
      { ...base, momentId: "old", createdAtMs: now - 12 * 3_600_000 },
      { ...base, momentId: "new", createdAtMs: now }
    ];
    const ranked = rankSpotlightMoments(moments, now);
    expect(ranked[0].momentId).toBe("new");
    expect(moments[0].momentId).toBe("old");
  });

  it("ranks only AFTER authorization, so scoring cannot widen visibility", () => {
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    expect(feed.indexOf("resolveMomentVisibility")).toBeLessThan(feed.indexOf("rankSpotlightMoments"));
    expect(feed).toContain("const authorized = candidates.filter");
  });
});

// ---------------------------------------------------------------------------
// Audience and privacy
// ---------------------------------------------------------------------------

describe("audience model", () => {
  const baseVisibility = {
    isAuthor: false,
    status: "active" as const,
    expiresAtMs: 2_000,
    nowMs: 1_000,
    isBlockedEitherDirection: false,
    authorGhostMode: false,
    viewerHidThis: false,
    viewerInAudience: false,
    viewerNearbyAndFresh: false
  };

  it("shows an All Muddies Moment to any approved Muddy, with no target rows", () => {
    const result = resolveMomentVisibility({
      ...baseVisibility,
      areApprovedMuddies: true,
      audienceType: "all_muddies"
    });
    expect(result.visible).toBe(true);
  });

  it("hides a private Moment from a non-Muddy", () => {
    for (const audienceType of ["all_muddies", "selected_muddies", "close_friends"] as MomentAudienceType[]) {
      const result = resolveMomentVisibility({ ...baseVisibility, areApprovedMuddies: false, audienceType });
      expect(result.visible, audienceType).toBe(false);
      expect(result.reason).toBe("not_muddies");
    }
  });

  it("still requires explicit membership for Selected Muddies", () => {
    expect(
      resolveMomentVisibility({
        ...baseVisibility,
        areApprovedMuddies: true,
        audienceType: "selected_muddies",
        viewerInAudience: false
      }).visible
    ).toBe(false);
    expect(
      resolveMomentVisibility({
        ...baseVisibility,
        areApprovedMuddies: true,
        audienceType: "selected_muddies",
        viewerInAudience: true
      }).visible
    ).toBe(true);
  });

  it("lets a block override every audience, including Spotlight", () => {
    for (const audienceType of ["all_muddies", "public"] as MomentAudienceType[]) {
      const result = resolveMomentVisibility({
        ...baseVisibility,
        areApprovedMuddies: true,
        isBlockedEitherDirection: true,
        audienceType
      });
      expect(result.visible, audienceType).toBe(false);
      expect(result.reason).toBe("blocked");
    }
  });

  it("expires server-side regardless of audience", () => {
    for (const audienceType of ["all_muddies", "public"] as MomentAudienceType[]) {
      const result = resolveMomentVisibility({
        ...baseVisibility,
        areApprovedMuddies: true,
        audienceType,
        expiresAtMs: 500
      });
      expect(result.visible, audienceType).toBe(false);
      expect(result.reason).toBe("expired");
    }
  });

  it("recognises the Spotlight audience by its canonical value", () => {
    expect(isSpotlightAudience("public")).toBe(true);
    expect(isSpotlightAudience("all_muddies")).toBe(false);
  });

  it("keeps the all_muddies migration additive", () => {
    const sql = read("supabase/migrations/20260731110000_moments_all_muddies_audience.sql").toLowerCase();
    expect(sql).toContain("'all_muddies'");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("update public.moments");
  });
});

describe("view and reach privacy", () => {
  it("records one view per viewer per Moment", () => {
    expect(MIGRATION).toContain("constraint moment_views_unique unique (moment_id, viewer_id)");
    expect(SERVICE).toContain('{ onConflict: "moment_id,viewer_id", ignoreDuplicates: true }');
  });

  it("lets a viewer read only their own view rows", () => {
    expect(MIGRATION).toContain('create policy "moment views owned by viewer" on public.moment_views');
    expect(MIGRATION).toContain("for all using (auth.uid() = viewer_id)");
  });

  it("re-checks visibility before recording, so reach cannot be manufactured", () => {
    const view = declaration(ACTIONS, "export async function recordMomentViewAction");
    expect(view).toContain("canViewMoment(admin, userId, momentId)");
  });

  it("shows reach to every authorised viewer, as an aggregate", () => {
    // Changed deliberately (approved 2026-08-06): view counts appear on every
    // card, not only the author's. This is a product decision, and the count
    // remains an AGGREGATE — the tests below still forbid exposing WHO viewed.
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    expect(feed).toContain("viewCount: stats?.views ?? 0");
    expect(feed).not.toContain("viewCount: isAuthor");
  });

  it("keeps attributed tune-ins author-only", () => {
    // Unlike a view count, this is the creator's own growth analytics rather
    // than a public engagement signal, so it did NOT change.
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    expect(feed).toContain("tunedInFromThis: isAuthor ? (stats?.tunedIn ?? 0) : null");
    const insights = declaration(read("components/content/moment-parts.tsx"), "export function AuthorInsights");
    expect(insights).toContain("moment.isAuthor");
  });

  it("states a relationship only where the viewer actually has one", () => {
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    // Derived from the viewer's own friend set; never a relationship they are
    // not part of, and null when there is none to state.
    expect(feed).toContain("muddyIds.has(moment.author_id)");
    expect(feed).toContain('viewerRelationship: isAuthor');
  });

  it("exposes no viewer list to anyone", () => {
    expect(SERVICE).not.toMatch(/viewer_id,\s*profiles/);
    const type = declaration(SERVICE, "export type VisibleMoment");
    expect(type).not.toContain("viewers");
  });
});

describe("creator hub exposes only public information", () => {
  const hub = declaration(SERVICE, "export async function loadMomentsCreatorHub");

  it("selects a name and avatar and nothing more", () => {
    expect(hub).toContain('select("user_id, full_name, avatar_url")');
    for (const leak of ["visibility_status", "bio", "email", "phone", "general_area", "mood_status"]) {
      expect(hub, `hub selects ${leak}`).not.toContain(leak);
    }
  });

  it("returns nothing for a blocked creator", () => {
    expect(hub).toContain("if (blocks?.length) return null;");
  });

  it("keeps Add Muddy and Tune In as separate actions", () => {
    const modal = declaration(read("components/content/moments-page.tsx"), "function CreatorHubModal");
    expect(modal).toContain("Add Muddy");
    expect(modal).toContain("TuneInButton");
    // Add Muddy routes to the existing friendship surface, not a new system.
    expect(modal).toContain('href="/friends"');
  });
});

// ---------------------------------------------------------------------------
// Spotlight publishing entitlement
// ---------------------------------------------------------------------------

describe("Spotlight publishing is server-enforced", () => {
  it("reuses the existing canonical capability", () => {
    // public_moments already WAS the Spotlight publishing entitlement, so a
    // parallel spotlight_publish key would have been a second source of truth.
    expect(ACTIONS).toContain('checkFeature(entitlements, "public_moments")');
    const catalog = read("lib/billing/entitlement-catalog.ts");
    expect(catalog).toContain('key: "public_moments"');
    for (const file of ["lib/billing/entitlements.ts", "lib/billing/entitlement-catalog.ts"]) {
      expect(read(file)).not.toContain("spotlight_publish");
    }
  });

  it("takes the entitled tiers from canonical product configuration", () => {
    // Whatever the registry says is what applies; the test does not assert a
    // hardcoded tier of its own beyond Free being excluded.
    expect(PLAN_ENTITLEMENTS.free.public_moments).toBe(false);
    const entitled = (["free", "buddy_plus", "buddy_pro"] as const).filter(
      (plan) => PLAN_ENTITLEMENTS[plan].public_moments
    );
    expect(entitled.length).toBeGreaterThan(0);
    expect(entitled).not.toContain("free");
  });

  it("enforces publishing in the action, not only in the UI", () => {
    const create = declaration(ACTIONS, "export async function createMomentAction");
    expect(create).toContain("resolveUserEntitlements");
    expect(create.indexOf("checkFeature")).toBeLessThan(create.indexOf(".from(\"moments\")"));
  });

  it("mirrors the rule at the RLS boundary too", () => {
    const sql = read("supabase/migrations/20260724170000_open_moments_feature.sql");
    expect(sql).toContain("public.can_publish_open_moments(auth.uid())");
  });

  it("lets every authenticated user VIEW Spotlight", () => {
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    // No entitlement gate on the read path, only the feature flag.
    expect(feed).toContain("isOpenMomentsEnabled(admin)");
    expect(feed).not.toContain("checkFeature");
    expect(feed).not.toContain("public_moments");
  });

  it("explains the upgrade rather than silently disabling the row", () => {
    const composer = read("components/content/moment-composer.tsx");
    expect(composer).toContain("Go On Air");
    expect(composer).toContain("Share your Moment beyond your Muddies.");
    // The body, plan name, price and benefits all come from canonical billing
    // data rather than being written in the component.
    expect(composer).toContain("spotlightUpgradeCopy()");
    expect(composer).not.toMatch(/GHS\s?\d/);
    // Routes into the EXISTING upgrade flow, not a second checkout.
    expect(composer).toContain('href="/upgrade"');
    expect(composer).not.toContain("paystack");
    // No fake urgency.
    for (const pressure of ["hurry", "limited time", "expires soon", "only today", "act now"]) {
      expect(composer.toLowerCase()).not.toContain(pressure);
    }
  });
});

// ---------------------------------------------------------------------------
// Image-only phase
// ---------------------------------------------------------------------------

describe("this phase creates images only", () => {
  const composer = read("components/content/moment-composer.tsx");

  it("always publishes contentType photo", () => {
    expect(composer).toContain('contentType: "photo"');
    expect(composer).not.toContain('contentType: "text"');
    expect(composer).not.toContain('contentType: "video"');
  });

  it("refuses a video selection", () => {
    expect(composer).toContain('file.type.startsWith("video/")');
    expect(composer).toContain("Moments are photos for now");
    expect(composer).not.toContain("validateVideoSelection");
  });

  it("offers camera and library, both image-only", () => {
    expect(composer).toContain('accept="image/*"');
    expect(composer).toContain('capture="environment"');
    expect(composer).toContain('accept="image/jpeg,image/png,image/webp,image/heic"');
  });

  it("still renders a legacy text or video Moment rather than dropping it", () => {
    // Existing posts must not vanish just because the composer narrowed.
    const media = declaration(read("components/content/moment-parts.tsx"), "export function MomentMedia");
    expect(media).toContain('moment.contentType === "text"');
    expect(media).toContain('moment.contentType === "video"');
  });
});

// ---------------------------------------------------------------------------
// Storage and performance
// ---------------------------------------------------------------------------

describe("media storage and delivery", () => {
  it("stores a path reference, never binary, in Postgres", () => {
    const sql = read("supabase/migrations/20260717140000_moments_drops_media_safety.sql").toLowerCase();
    expect(sql).toContain("storage_key");
    expect(sql).not.toContain("bytea");
    expect(sql).not.toContain("base64");
  });

  it("keeps private Moment media unreadable without a short-lived signed URL", () => {
    expect(SERVICE).toContain("createSignedUrl");
    const ttl = /SIGNED_URL_TTL_SECONDS = ([^;]+);/.exec(read("lib/content/service.ts"))?.[1] ?? "";
    expect(ttl).toContain("60");
  });

  it("serves a processed variant, not the original, to a feed card", () => {
    expect(SERVICE).toContain('signMediaForAsset(admin, moment.media_id, "feed")');
    const dimensions = read("lib/media/processing.ts");
    expect(dimensions).toContain("thumb: 256");
    expect(dimensions).toContain("feed: 1080");
  });

  it("signs a whole page in parallel rather than one await per card", () => {
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    expect(feed).toContain("await Promise.all(");
    expect(feed).toContain("signed[index]");
  });

  it("lazy-loads all but the first image and reserves layout space", () => {
    const image = read("components/ui/moment-image.tsx");
    expect(image).toContain('loading={priority ? "eager" : "lazy"}');
    expect(image).toContain('decoding="async"');
    const media = declaration(read("components/content/moment-parts.tsx"), "export function MomentMedia");
    // A fixed aspect ratio stops the feed jumping as images arrive.
    expect(media).toContain("aspect-square");
    expect(media).toContain("aspect-[4/5]");
  });
});

describe("expiry separates access from deletion", () => {
  it("stops access at expires_at through the shared rule", () => {
    expect(read("lib/content/moments.ts")).toContain('return { visible: false, reason: "expired" }');
    const feed = declaration(SERVICE, "export async function buildSpotlightFeed");
    expect(feed).toContain('.gt("expires_at", nowIso)');
  });

  it("does not rely on a client timer for access control", () => {
    const page = read("components/content/moments-page.tsx");
    // The client filter is explicitly presentation, and the server filters too.
    expect(page).toContain("PRESENTATION only");
    expect(stripComments(page)).toContain("Date.parse(moment.expiresAt) > nowMs");
  });

  it("queues physical media deletion separately from expiry", () => {
    expect(SERVICE).toContain("export async function queueMediaDeletion");
    expect(ACTIONS).toContain('queueMediaDeletion(admin, moment.media_id, "parent_deleted")');
  });
});

// ---------------------------------------------------------------------------
// Realtime and analytics
// ---------------------------------------------------------------------------

describe("Realtime is not required for correctness", () => {
  it("rebuilds state from the server on refresh", () => {
    const page = stripComments(read("components/content/moments-page.tsx"));
    expect(page).toContain("getMomentFeedAction()");
    expect(page).toContain("getOpenMomentFeedAction()");
  });

  it("does not poll", () => {
    const page = read("components/content/moments-page.tsx");
    // The only interval is the once-a-minute display clock, which fetches nothing.
    const clock = declaration(read("components/content/moment-parts.tsx"), "export function useMomentClock");
    expect(clock).toContain("60_000");
    expect(clock).not.toContain("Action(");
    expect(page).not.toContain("setInterval");
  });
});

describe("analytics", () => {
  it("declares every event this phase needs", () => {
    for (const event of [
      "moment_create_started",
      "moment_published",
      "moment_viewed",
      "moment_reacted",
      "moment_reaction_changed",
      "moment_deleted",
      "moment_expired",
      "spotlight_viewed",
      "spotlight_publish_attempted",
      "spotlight_published",
      "tune_in_added",
      "tune_in_removed",
      "tune_in_from_moment"
    ]) {
      expect(PRODUCT_EVENT_NAMES).toContain(event);
    }
  });

  it("reuses the existing analytics pipeline", () => {
    expect(ACTIONS).toContain('from "@/lib/analytics/track"');
    expect(ACTIONS).toContain("recordProductEvent(admin, {");
  });

  it("never logs caption or text content", () => {
    const calls = [...ACTIONS.matchAll(/recordProductEvent\(admin, \{[\s\S]*?\}\);/g)].map((match) => match[0]);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const call of calls) {
      expect(call).not.toContain("caption");
      expect(call).not.toContain("textContent");
      expect(call).not.toContain("text_content");
    }
  });
});
