#!/usr/bin/env node
/**
 * Seed ONE pending Trusted Member application, for testing the review queue.
 *
 * WHY THIS EXISTS: the real bar is 90 days of premium plus all ten Journeys.
 * No account is old enough yet, so the queue cannot be reached through the
 * product. This puts a single application in front of a reviewer and stops
 * there.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   * It never sets `trusted_member_since`. The badge is granted by approving
 *     through the real admin action, which is the thing under test. A script
 *     that granted it directly would test nothing.
 *   * It never touches subscriptions or journey progress. The snapshot columns
 *     record what a qualifying applicant WOULD have looked like; the person's
 *     actual history is left alone.
 *   * It never weakens `trustedMemberEligibility`. Production rules are
 *     unchanged, and a real application still has to clear them.
 *
 * So this is not a backdoor to the badge — it is a backdoor to the QUEUE, and
 * every gate after that point is the real one.
 *
 * Usage:
 *   node scripts/seed-trusted-application.mjs <username>
 *   node scripts/seed-trusted-application.mjs <username> --remove
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Marks the row as test data in a column the schema already has. A reviewer
// opening the queue sees immediately that this is not a real applicant.
const TEST_NOTE = "[TEST DATA] Seeded to exercise the review queue. Not a real application.";

function loadEnv() {
  // .env.local, read directly: this is a one-off operator script, not part of
  // the app, so it does not pull in the framework's env machinery.
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Fall through to whatever is already in the environment.
  }
}

async function main() {
  loadEnv();

  const username = process.argv[2];
  const remove = process.argv.includes("--remove");

  if (!username) {
    console.error("Usage: node scripts/seed-trusted-application.mjs <username> [--remove]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, trusted_member_since")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    console.error(`No profile found for username "${username}".`);
    process.exit(1);
  }

  if (remove) {
    // Removes ONLY the seeded application, matched on the test marker so a
    // genuine application from the same person is never deleted by accident.
    const { data: deleted } = await admin
      .from("trusted_member_applications")
      .delete()
      .eq("user_id", profile.user_id)
      .eq("note", TEST_NOTE)
      .select("id, status");

    if (!deleted?.length) {
      console.log("Nothing to remove: no seeded application found for that account.");
      console.log("(A real application, or one whose note was edited, is left untouched.)");
      process.exit(0);
    }

    console.log(`Removed seeded application (was: ${deleted[0].status}).`);
    if (profile.trusted_member_since) {
      // Reported rather than cleared: if the badge was granted, that happened
      // through the real approval action and is real state. Revoking it is a
      // product decision made in the admin queue, not something a cleanup
      // script should do silently.
      console.log("");
      console.log("NOTE: this account still holds trusted_member_since.");
      console.log("That was set by a REAL approval. Revoke it in /admin/trusted-members");
      console.log("if you want it cleared — this script will not touch it.");
    }
    console.log("Audit entries from any real approval or decline are left intact.");
    process.exit(0);
  }

  if (profile.trusted_member_since) {
    console.log(`${profile.username} is already a Trusted Member. Nothing to seed.`);
    process.exit(0);
  }

  // Idempotent: one row per user is enforced by the unique constraint, and
  // upserting back to pending means re-running resets the test rather than
  // failing or duplicating.
  const nowIso = new Date().toISOString();
  const { error } = await admin.from("trusted_member_applications").upsert(
    {
      user_id: profile.user_id,
      status: "pending",
      note: TEST_NOTE,
      // What a qualifying applicant would look like. The snapshot is what the
      // reviewer sees; the person's real premium and journey history is not
      // modified by this script.
      premium_days_at_apply: 92,
      journeys_complete_at_apply: 10,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      updated_at: nowIso
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Failed to seed:", error.message);
    process.exit(1);
  }

  console.log(`Seeded a PENDING application for ${profile.username}.`);
  console.log("");
  console.log("The badge is NOT granted. Approve it at /admin/trusted-members");
  console.log("to exercise the real approval path.");
  console.log("");
  console.log(`Clean up with: node scripts/seed-trusted-application.mjs ${username} --remove`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
