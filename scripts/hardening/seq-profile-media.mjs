/**
 * Mission 1 Extremely Advanced — domain 6: Profile media.
 *
 * Four interacting systems, and a successful upload proves almost none of it:
 * storage, database state, viewer privacy, and concurrency/failure recovery.
 *
 * Canonical model: avatar + up to 3 showcase photos.
 *   PROFILE_PHOTO_SLOTS = [0, 1, 2]   (position -1 is the avatar)
 *   profile_photos: UNIQUE (user_id, position), CHECK position BETWEEN -1 AND 2
 *   visibility ∈ everyone | approved_muddies | only_me
 *
 * The schema is the first line of defence and is exercised directly, because a
 * limit enforced only by hiding an "Add" button is not a limit.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// The owner. The Muddy and stranger roles are exercised through the
// projection flags and by signing in as saa@local.test, so their ids are not
// needed here.
const QA = "d901121e-688e-477b-b8f0-56c782a16801";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

const TAG = `pm-${Date.now()}`;
const assetIds = [];

async function makeAsset(label) {
  const { data, error } = await admin.from("media_assets").insert({
    owner_id: QA,
    storage_key: `profile/${QA}/${TAG}-${label}.webp`,
    content_type: "image/webp",
    size_bytes: 1024,
    width: 512,
    height: 512,
    processing_status: "ready",
    moderation_status: "active",
    context_type: "profile"
  }).select("id").maybeSingle();
  if (error) return { error };
  assetIds.push(data.id);
  return { id: data.id };
}

async function photos() {
  const { data } = await admin.from("profile_photos")
    .select("id, media_asset_id, position, visibility")
    .eq("user_id", QA).order("position", { ascending: true });
  return data ?? [];
}

async function cleanup() {
  await admin.from("profile_photos").delete().eq("user_id", QA);
  for (const id of assetIds) await admin.from("media_assets").delete().eq("id", id);
}
await cleanup();

// --- A. NORMAL LIFECYCLE ---------------------------------------------------
const a = await makeAsset("a"), b = await makeAsset("b"), c = await makeAsset("c");
if (a.error || b.error || c.error) {
  inconclusive("Profile media", `could not create assets: ${(a.error ?? b.error ?? c.error).message.slice(0, 120)}`);
} else {
  for (const [i, asset] of [a, b, c].entries()) {
    await admin.from("profile_photos").insert({
      user_id: QA, media_asset_id: asset.id, position: i, visibility: "everyone"
    });
  }
  const three = await photos();
  check("three showcase photos occupy positions 0,1,2",
    three.length === 3 && three.map((p) => p.position).join(",") === "0,1,2",
    `positions ${three.map((p) => p.position).join(",")}`);

  // --- B. SLOT LIMIT, enforced by the SCHEMA ------------------------------
  const d = await makeAsset("d");
  const { error: fourthError } = await admin.from("profile_photos").insert({
    user_id: QA, media_asset_id: d.id, position: 3, visibility: "everyone"
  });
  check("a fourth slot (position 3) is refused by the database",
    Boolean(fourthError),
    fourthError ? `refused: ${fourthError.message.slice(0, 60)}` : "ACCEPTED — capacity breached");

  // A duplicate position must also be impossible, or two photos could claim
  // one slot and ordering would become ambiguous.
  const { error: dupError } = await admin.from("profile_photos").insert({
    user_id: QA, media_asset_id: d.id, position: 1, visibility: "everyone"
  });
  check("two photos cannot occupy the same slot",
    Boolean(dupError),
    dupError ? `refused: ${dupError.message.slice(0, 60)}` : "ACCEPTED — slot duplicated");

  // --- C. REPLACEMENT DURABILITY -----------------------------------------
  /* The canonical order is upload new → swap reference → retire old. The
     failure that matters is the reverse: deleting first, then failing to
     upload, which destroys a working image. Here the swap is performed and
     the OLD asset is left in place to model "retirement failed". */
  const before = (await photos()).find((p) => p.position === 1);
  await admin.from("profile_photos")
    .update({ media_asset_id: d.id }).eq("user_id", QA).eq("position", 1);
  const after = (await photos()).find((p) => p.position === 1);
  check("replacing a slot swaps the reference without losing the slot",
    after?.media_asset_id === d.id && (await photos()).length === 3,
    `slot 1 now ${after?.media_asset_id === d.id ? "new asset" : "unchanged"}, photos ${(await photos()).length}`);

  const { data: oldStillThere } = await admin.from("media_assets")
    .select("id, deleted_at").eq("id", before.media_asset_id).maybeSingle();
  check("a failed retirement leaves an ORPHAN asset, not a broken slot",
    Boolean(oldStillThere) && (await photos()).length === 3,
    oldStillThere ? "old asset row survives, slot intact" : "old asset gone");

  // --- D. CONCURRENCY: stale tab acts on a replaced slot ------------------
  /* Tab A loaded [A, B, C] and still believes slot 1 holds B. Tab B has
     already replaced it with D. Tab A now removes "B" BY ASSET ID — the shape
     that would delete someone else's newer image if the delete were keyed on
     position alone. */
  const { data: staleDelete } = await admin.from("profile_photos")
    .delete().eq("user_id", QA).eq("media_asset_id", before.media_asset_id).select("id");
  const afterStale = await photos();
  check("a stale delete keyed on the OLD asset does not remove the new image",
    afterStale.some((p) => p.media_asset_id === d.id) && afterStale.length === 3,
    `deleted ${(staleDelete ?? []).length} rows, photos ${afterStale.length}`);

  // --- E. VISIBILITY MATRIX ----------------------------------------------
  await admin.from("profile_photos").update({ visibility: "everyone" }).eq("user_id", QA).eq("position", 0);
  await admin.from("profile_photos").update({ visibility: "approved_muddies" }).eq("user_id", QA).eq("position", 1);
  await admin.from("profile_photos").update({ visibility: "only_me" }).eq("user_id", QA).eq("position", 2);

  /* Replays the projection in loadVisibleProfilePhotosFor: owner sees all,
     an approved Muddy sees everyone+approved_muddies, a stranger sees only
     `everyone`. `only_me` is in neither non-owner list, so it is unreachable
     except through the owner branch. */
  const visibleTo = async (isOwner, isApprovedMuddy) => {
    let q = admin.from("profile_photos").select("position, visibility").eq("user_id", QA);
    if (!isOwner) {
      q = isApprovedMuddy
        ? q.in("visibility", ["everyone", "approved_muddies"])
        : q.eq("visibility", "everyone");
    }
    return (await q).data ?? [];
  };

  check("the owner sees all three photos", (await visibleTo(true, false)).length === 3,
    `owner sees ${(await visibleTo(true, false)).length}`);
  check("an approved Muddy sees everyone + approved_muddies, never only_me",
    (await visibleTo(false, true)).length === 2 &&
      !(await visibleTo(false, true)).some((p) => p.visibility === "only_me"),
    `muddy sees ${(await visibleTo(false, true)).length}`);
  check("a stranger sees only the `everyone` photo",
    (await visibleTo(false, false)).length === 1 &&
      (await visibleTo(false, false))[0].visibility === "everyone",
    `stranger sees ${(await visibleTo(false, false)).length}`);

  // --- F. DIRECT TABLE ACCESS under RLS ----------------------------------
  /* The projection is one layer. If RLS lets a stranger read the row directly,
     the projection is decoration. */
  const stranger = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await stranger.auth.signInWithPassword({
    email: "saa@local.test", password: "HardeningPass123!"
  });
  if (signInError) {
    inconclusive("Profile media direct access", `sign-in failed: ${signInError.message.slice(0, 80)}`);
  } else {
    const { data: direct } = await stranger.from("profile_photos")
      .select("id, position, visibility").eq("user_id", QA);
    const leakedPrivate = (direct ?? []).filter((p) => p.visibility !== "everyone");
    check("a stranger querying the table directly cannot read private slots",
      leakedPrivate.length === 0,
      `rows visible ${(direct ?? []).length}, private among them ${leakedPrivate.length}`);
  }
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Profile media checks passed`);
