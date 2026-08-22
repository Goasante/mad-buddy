/**
 * Seeds real location rows so the privacy probe has something to catch.
 *
 * WHY THIS MATTERS. A privacy test that runs against an empty dataset proves
 * nothing: `{"friends":[]}` contains no coordinates because it contains no
 * data, not because the projection is safe. To claim "exact location is never
 * exposed" the fixture must contain exact locations that COULD leak.
 *
 * Places qatester and both Muddies within a few hundred metres of each other in
 * Accra, so the proximity projection has genuine near-neighbours to describe.
 * LOCAL SUPABASE ONLY.
 */
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!URL.includes("127.0.0.1")) throw new Error("refusing to seed a non-local database");

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// Accra, University of Ghana area. Offsets are ~100-400m apart, which is close
// enough that the six-level Glow has a real band to resolve.
const BASE_LAT = 5.6508;
const BASE_LNG = -0.1869;

const PEOPLE = [
  { username: "qatester", dLat: 0,        dLng: 0 },
  { username: "kofim",    dLat: 0.0009,   dLng: 0.0006 },   // ~120m
  { username: "amab",     dLat: -0.0025,  dLng: 0.0018 },   // ~340m
  { username: "saao",     dLat: 0.0040,   dLng: -0.0031 }   // stranger, further out
];

for (const person of PEOPLE) {
  const { data: profile } = await admin
    .from("profiles").select("user_id").eq("username", person.username).maybeSingle();
  if (!profile) { console.log(`${person.username}: no profile`); continue; }

  const { error } = await admin.from("user_locations").upsert({
    user_id: profile.user_id,
    latitude: BASE_LAT + person.dLat,
    longitude: BASE_LNG + person.dLng,
    accuracy: 25,
    confidence: "high",
    last_updated: new Date().toISOString()
  }, { onConflict: "user_id" });

  console.log(`${person.username}: ${error ? error.message : "location set"}`);
}

const { count } = await admin.from("user_locations").select("id", { count: "exact", head: true });
console.log(`\nuser_locations rows: ${count}`);
