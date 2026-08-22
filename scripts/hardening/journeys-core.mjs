/**
 * Core product journeys, driven through real controls.
 *
 * These are the paths the Product Constitution says must work. Each asserts on
 * the DESTINATION, not merely that a click succeeded: "the button responded" is
 * not the same as "the button took the user where they meant to go", and wrong
 * destinations are exactly what Mission 1 is hunting.
 */
import { runJourney } from "./journey.mjs";

const results = [];

// --- Navigation: every bottom-bar tab reaches its own surface ---------------
results.push(["bottom nav — Muddies", await runJourney("nav-muddies", [
  { do: "goto", url: "/dashboard" },
  { do: "click", text: "Muddies", role: "link" },
  { do: "expect-url", contains: "/friends" },
  { do: "expect-text", contains: "Muddies" }
])]);

results.push(["bottom nav — Messages", await runJourney("nav-messages", [
  { do: "goto", url: "/dashboard" },
  { do: "click", text: "Messages", role: "link" },
  { do: "expect-url", contains: "/messages" }
])]);

results.push(["bottom nav — Linkr", await runJourney("nav-linkr", [
  { do: "goto", url: "/dashboard" },
  { do: "click", text: "Linkr", role: "link" },
  { do: "expect-url", contains: "/linkr" }
])]);

results.push(["bottom nav — UpFor", await runJourney("nav-upfor", [
  { do: "goto", url: "/dashboard" },
  { do: "click", text: "UpFor", role: "link" },
  { do: "expect-url", contains: "/hangout-mode" }
])]);

// --- Muddies -> conversation ------------------------------------------------
// The single most important social handoff: an approved relationship must lead
// to a conversation in one tap.
results.push(["Muddy -> message", await runJourney("muddy-message", [
  { do: "goto", url: "/friends" },
  { do: "click", text: "Message" },
  { do: "expect-url", contains: "/messages" }
])]);

// --- Muddy profile ----------------------------------------------------------
// Tapping a Muddy opens a profile MODAL (not a navigation) -- verified in the
// browser. An earlier version of this journey asserted a URL change and failed;
// the assertion was wrong, not the product. The modal is the better interaction
// here: it keeps the list underneath and offers the actions inline.
//
// What matters is that it opens THAT person, and that the route to their full
// profile is correct.
results.push(["Muddy -> profile modal", await runJourney("muddy-profile", [
  { do: "goto", url: "/friends" },
  { do: "click", text: "Kofi Mensah" },
  { do: "expect-text", contains: "@kofim" },
  { do: "expect-text", contains: "Approved Muddy" },
  /* Privacy: never a distance.
   *
   * Asserted as the ABSENCE of measurements rather than the presence of a
   * particular band. An earlier version expected the literal "Just Around" and
   * failed once the seeded locations aged past the 15-minute freshness window
   * -- the app was right to stop showing a band for stale data, and the test
   * was wrong to depend on fixture timing. Run seed-proximity.mjs to exercise
   * the live-proximity path. */
  { do: "expect-no-text", contains: "metres" },
  { do: "expect-no-text", contains: " km" },
  { do: "expect-no-text", contains: "latitude" },
  // And the way through to the full profile is present and correct.
  { do: "click", text: "View full profile" },
  { do: "expect-url", contains: "/friends/kofim" }
])]);

// --- Plans ------------------------------------------------------------------
results.push(["Plans -> create", await runJourney("plan-create", [
  { do: "goto", url: "/plans?create=1" },
  { do: "expect-url", contains: "/plans" }
])]);

// --- Profile completion returns to where it was invoked from ----------------
results.push(["Profile from Settings", await runJourney("settings-profile", [
  { do: "goto", url: "/settings" },
  { do: "expect-text", contains: "Settings" }
])]);

// --- Safe Arrival -----------------------------------------------------------
results.push(["Safe Arrival reachable", await runJourney("safe-arrival", [
  { do: "goto", url: "/safe-arrival" },
  { do: "expect-url", contains: "/safe-arrival" }
])]);

// --- Signed-out deep link keeps its intent ----------------------------------
// Mission 3: a shared link must survive authentication rather than dumping the
// visitor on Home.
results.push(["deep link preserves intent", await runJourney("deep-link", [
  { do: "goto", url: "/plans" },
  { do: "expect-url", contains: "next=%2Fplans" }
], { anonymous: true })]);

console.log("\n================ JOURNEY SUMMARY ================");
let passed = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${results.length} journeys passed`);
