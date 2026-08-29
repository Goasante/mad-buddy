/**
 * Seeds Muddies fixture states into the LOCAL Supabase only.
 *
 * Muddies is a relationship surface, so the states that matter are about the
 * SHAPE of the graph -- none, one, a handful, a large list -- plus the awkward
 * rows a real graph contains: somebody with no avatar, somebody with a very
 * long display name, somebody currently UpFor, somebody nearby and somebody
 * not. An empty database exercises none of them.
 *
 * Usage:  node scripts/seed-muddies-fixture.mjs [zero|one|few|many]
 *
 * REFUSES TO RUN AGAINST ANYTHING BUT LOCALHOST.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const ME = "4a000000-0000-4000-8000-00000000004a";
const MODE = process.argv[2] ?? "few";

/** Real seeded accounts, in the order they should be befriended. */
const REAL = [
  { id: "4b000000-0000-4000-8000-00000000004b", name: "Bediako" },
  { id: "4c000000-0000-4000-8000-00000000004c", name: "Comfort" },
  { id: "b0000000-0000-4000-8000-00000000000b", name: "Bright" },
  { id: "c0000000-0000-4000-8000-00000000000c", name: "Cynthia" },
  { id: "4d000000-0000-4000-8000-00000000004d", name: "Delali" }
];

/** Synthetic Muddies, for the large-graph case. */
const SYNTHETIC_COUNT = 40;
const FIRST_NAMES = [
  "Ama", "Kofi", "Esi", "Yaw", "Abena", "Kwabena", "Akua", "Kwaku",
  "Afia", "Kojo", "Adwoa", "Kwame", "Akosua", "Kwadwo", "Yaa", "Fiifi"
];

function syntheticId(index) {
  return `5${index.toString(16).padStart(3, "0")}0000-0000-4000-8000-${index
    .toString(16)
    .padStart(12, "0")}`;
}

async function ensureSyntheticProfile(index) {
  const id = syntheticId(index);
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  /* One deliberately punishing row: a display name far longer than any
     sensible layout expects. A list that only ever sees "Ama" hides its
     truncation bugs until a real user finds them. */
  const name =
    index === 3
      ? `${first} Nana Yaa Serwaa Adjeiwaa-Boateng the Third of East Legon`
      : `${first} ${String.fromCharCode(65 + (index % 26))}.`;

  const { error } = await admin.auth.admin.createUser({
    id,
    email: `muddy${index}@fixture.local`,
    password: "MuddiesReview123!",
    email_confirm: true
  });
  // Already exists is fine; anything else is worth seeing.
  if (error && !/already|duplicate|exists/i.test(error.message)) {
    throw new Error(`createUser ${index}: ${error.message}`);
  }

  await admin.from("profiles").upsert(
    {
      user_id: id,
      full_name: name,
      username: `muddy${index}`,
      // Index 5 keeps NO avatar on purpose: the initials fallback is a real
      // state and must look deliberate rather than broken.
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  return { id, name };
}

async function befriend(otherId) {
  // The pair is stored sorted, matching friendships_unique_pair.
  const [low, high] = [ME, otherId].sort();
  const { error } = await admin
    .from("friendships")
    .upsert(
      { user_one_id: low, user_two_id: high, ended_at: null },
      { onConflict: "user_one_id,user_two_id" }
    );
  if (error) throw new Error(`befriend ${otherId}: ${error.message}`);
}

async function clearFriendships() {
  await admin
    .from("friendships")
    .delete()
    .or(`user_one_id.eq.${ME},user_two_id.eq.${ME}`);
}

/** Puts somebody at a coarse distance, so proximity bands differ per row. */
async function placeNear(userId, metres) {
  await admin.from("user_locations").upsert(
    {
      user_id: userId,
      latitude: 5.6037 + metres / 111_320,
      longitude: -0.187,
      accuracy: 25,
      confidence: "high",
      last_updated: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
}

await clearFriendships();

if (MODE === "zero") {
  console.log("seeded: zero Muddies");
} else {
  const count = MODE === "one" ? 1 : MODE === "few" ? 3 : REAL.length;
  for (let i = 0; i < count; i += 1) {
    await befriend(REAL[i].id);
    // A spread of distances: two with a live signal, the rest without.
    await placeNear(REAL[i].id, [80, 700, 4000, 9000, 30000][i] ?? 50000);
  }
  console.log(`seeded: ${count} real Muddies`);

  if (MODE === "many") {
    for (let i = 0; i < SYNTHETIC_COUNT; i += 1) {
      const person = await ensureSyntheticProfile(i);
      await befriend(person.id);
      // Only the first handful get a location, so "Nearby" stays meaningful
      // rather than becoming the whole list.
      if (i < 6) await placeNear(person.id, 200 + i * 900);
    }
    console.log(`seeded: +${SYNTHETIC_COUNT} synthetic Muddies`);
  }
}

const { count } = await admin
  .from("friendships")
  .select("id", { count: "exact", head: true })
  .or(`user_one_id.eq.${ME},user_two_id.eq.${ME}`);
console.log(`viewer now has ${count} Muddies`);
