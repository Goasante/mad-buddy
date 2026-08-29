/**
 * Seeds a realistic Linkr fixture into the LOCAL Supabase only.
 *
 * Exists so the Linkr experience can actually be LOOKED AT: real candidates,
 * real signed photos, single-photo and multi-photo people, an incomplete
 * profile, and a viewer who is ready to browse. Discovery has a lot of
 * preconditions (Linkr on, 18+, avatar present, a location row, compatible
 * intent, freshness) and an empty database exercises none of them.
 *
 * REFUSES TO RUN AGAINST ANYTHING BUT LOCALHOST.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("REFUSING: not a local Supabase URL:", url);
  process.exit(1);
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Accra, so proximity tiers resolve to something plausible. */
const BASE = { lat: 5.6037, lng: -0.187 };

const PEOPLE = [
  {
    id: "4a000000-0000-4000-8000-00000000004a",
    name: "Adjoa",
    viewer: true,
    intent: "anything",
    bio: "Design student. Jollof purist. Always down for a beach walk.",
    age: 24,
    photos: 4,
    interests: ["Design", "Beach", "Afrobeats", "Photography"],
    metres: 0
  },
  {
    id: "4b000000-0000-4000-8000-00000000004b",
    name: "Bediako",
    intent: "networking",
    bio: "Building something in fintech. Coffee-fuelled.",
    age: 29,
    photos: 4,
    interests: ["Startups", "Coffee", "Running", "Chess"],
    metres: 120
  },
  {
    id: "4c000000-0000-4000-8000-00000000004c",
    name: "Comfort",
    intent: "friends",
    bio: "New in Accra. Looking for people to explore with.",
    age: 22,
    photos: 1,
    interests: ["Hiking", "Films"],
    metres: 900
  },
  {
    id: "4d000000-0000-4000-8000-00000000004d",
    name: "Delali",
    intent: "dating",
    bio: null,
    age: 27,
    photos: 2,
    interests: [],
    metres: 3200
  },
  {
    id: "b0000000-0000-4000-8000-00000000000b",
    name: "Bright",
    intent: "anything",
    bio: "Guitarist. Bad at football, still plays every Saturday.",
    age: 31,
    photos: 3,
    interests: ["Music", "Football", "Cooking"],
    metres: 5400
  },
  {
    id: "c0000000-0000-4000-8000-00000000000c",
    name: "Cynthia",
    intent: "friends",
    bio: "Nurse. Plant collector. Perpetually recommending books.",
    age: 26,
    photos: 4,
    interests: ["Books", "Plants", "Yoga", "Travel"],
    metres: 8000
  }
];

/** A recognisable portrait-shaped gradient with a big initial. */
async function portrait(name, index) {
  const palettes = [
    ["#E88C2B", "#4E0401"],
    ["#4E0401", "#E88C2B"],
    ["#C2410C", "#7C2D12"],
    ["#F59E0B", "#4E0401"]
  ];
  const [from, to] = palettes[index % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="900" height="1200" fill="url(#g)"/>
    <circle cx="450" cy="430" r="200" fill="rgba(255,255,255,0.16)"/>
    <text x="450" y="500" font-family="Georgia,serif" font-size="230" font-weight="bold"
          fill="rgba(255,255,255,0.92)" text-anchor="middle">${name[0]}</text>
    <text x="450" y="1080" font-family="Georgia,serif" font-size="58"
          fill="rgba(255,255,255,0.82)" text-anchor="middle">${name} &#183; ${index + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/** Uploads one image and registers its media_asset row. */
async function uploadPhoto(ownerId, name, index) {
  const body = await portrait(name, index);
  const key = `${ownerId}/linkr-fixture-${index}.jpg`;
  const up = await admin.storage.from("media").upload(key, body, {
    contentType: "image/jpeg",
    upsert: true
  });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);

  const { data, error } = await admin
    .from("media_assets")
    .insert({
      owner_id: ownerId,
      storage_key: key,
      content_type: "image/jpeg",
      size_bytes: body.length,
      width: 900,
      height: 1200,
      processing_status: "ready",
      moderation_status: "active",
      context_type: "profile"
    })
    .select("id")
    .single();
  if (error) throw new Error(`media_assets insert failed: ${error.message}`);
  return data.id;
}

/** Metres -> a rough lat/lng offset, so proximity tiers differ per person. */
function offsetBy(metres) {
  const dLat = metres / 111_320;
  return { latitude: BASE.lat + dLat, longitude: BASE.lng };
}

async function seedPerson(person) {
  const nowIso = new Date().toISOString();

  // --- Clean this person's previous fixture rows -------------------------
  const { data: old } = await admin
    .from("media_assets")
    .select("id")
    .eq("owner_id", person.id)
    .like("storage_key", "%linkr-fixture-%");
  const oldIds = (old ?? []).map((r) => r.id);
  if (oldIds.length) {
    await admin.from("profile_photos").delete().in("media_asset_id", oldIds);
    await admin.from("media_assets").delete().in("id", oldIds);
  }

  // --- Photos: first becomes the avatar, rest become showcase slots 0..2 --
  const assetIds = [];
  for (let i = 0; i < person.photos; i += 1) {
    assetIds.push(await uploadPhoto(person.id, person.name, i));
  }

  await admin
    .from("profiles")
    .update({ profile_media_id: assetIds[0] ?? null, updated_at: nowIso })
    .eq("user_id", person.id);

  await admin.from("profile_photos").delete().eq("user_id", person.id);
  for (let slot = 0; slot < Math.min(3, Math.max(0, assetIds.length - 1)); slot += 1) {
    await admin.from("profile_photos").insert({
      user_id: person.id,
      media_asset_id: assetIds[slot + 1],
      position: slot,
      // Stranger-safe on purpose: the projection admits only `everyone`.
      visibility: "everyone"
    });
  }

  // --- DOB: Profile is the authority, Linkr only derives an age ----------
  const birthYear = new Date().getUTCFullYear() - person.age;
  await admin.from("profile_birth_details").upsert(
    {
      user_id: person.id,
      date_of_birth: `${birthYear}-06-15`,
      updated_at: nowIso
    },
    { onConflict: "user_id" }
  );

  // --- Linkr profile ------------------------------------------------------
  await admin.from("linkr_profiles").upsert(
    {
      user_id: person.id,
      enabled: true,
      intent: person.intent,
      bio: person.bio,
      discovery_distance: person.viewer ? "wider" : "around_you",
      updated_at: nowIso
    },
    { onConflict: "user_id" }
  );

  // --- Location, so proximity tiers resolve ------------------------------
  const { latitude, longitude } = offsetBy(person.metres);
  await admin.from("user_locations").upsert(
    {
      user_id: person.id,
      latitude,
      longitude,
      accuracy: 25,
      confidence: "high",
      last_updated: nowIso
    },
    { onConflict: "user_id" }
  );

  // --- Interests ----------------------------------------------------------
  /* linkr_interests, NOT user_interests. The two lists are deliberately
     separate (see lib/profile/interests.ts): the profile list is the
     Muddy-facing identity vocabulary, and Linkr keeps its own so a dating
     vocabulary never leaks onto the profile. Linkr's card reads this one. */
  await admin.from("linkr_interests").delete().eq("user_id", person.id);
  for (const interest of person.interests) {
    const { error } = await admin
      .from("linkr_interests")
      .insert({ user_id: person.id, interest });
    if (error) throw new Error(`linkr_interests insert failed: ${error.message}`);
  }

  console.log(
    `seeded ${person.name.padEnd(9)} intent=${person.intent.padEnd(11)} photos=${person.photos} age=${person.age}`
  );
}

for (const person of PEOPLE) {
  try {
    await seedPerson(person);
  } catch (error) {
    console.error(`FAILED ${person.name}:`, error.message);
  }
}

console.log("\nviewer = Adjoa (4a000000-0000-4000-8000-00000000004a), distance=wider");
