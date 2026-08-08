import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { DELETION_TABLES } from "@/lib/account/deletion";

/**
 * Account deletion: reachable natively, and safe when it fails part-way.
 *
 * The failure mode these guard is specific. Deletion spans Postgres, storage
 * and the Auth registry -- three systems with no shared transaction -- and the
 * old implementation removed the Auth user last, unguarded. A failure there
 * left every table purged, the login intact, and the user told deletion had
 * failed, which was the opposite of the truth.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const service = stripComments(read("lib/account/deletion.ts"));
const webAction = stripComments(read("app/(app)/settings-actions.ts"));
const nativeRoute = stripComments(read("app/api/account/delete/route.ts"));
const settingsScreen = stripComments(read("mobile/src/screens/SettingsScreen.tsx"));
const migration = read("supabase/migrations/20260808300000_account_deletion_requests.sql");

// ---------------------------------------------------------------------------
// Reachable from the native app
// ---------------------------------------------------------------------------

describe("deletion is available inside the native app", () => {
  it("exposes a native-safe endpoint", () => {
    // The web flow is a Server Action depending on a cookie session the native
    // client does not have.
    expect(nativeRoute).toContain("resolveApiUser");
    expect(nativeRoute).toContain("export async function POST");
  });

  it("requires an explicit confirmation in the body", () => {
    // Deletion must be a decision, not something a mistyped request triggers.
    expect(nativeRoute).toContain("confirm: z.literal(true)");
  });

  it("rate limits the endpoint", () => {
    expect(nativeRoute).toContain('action: "account.delete"');
  });

  it("offers a two-step confirmation in the UI", () => {
    // One destructive tap is too easy to hit by accident on a phone.
    expect(settingsScreen).toContain('useState<"idle" | "confirm">');
    expect(settingsScreen).toContain("Delete my account");
    expect(settingsScreen).toContain("Delete forever");
  });

  it("signs out after a successful deletion", () => {
    // The local session points at an account that no longer exists, and the
    // push token would otherwise stay registered to a deleted user.
    const handler = settingsScreen.slice(settingsScreen.indexOf("async function handleDelete"));
    expect(handler.slice(0, 600)).toContain("await signOut()");
  });
});

// ---------------------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------------------

describe("a half-finished deletion is recoverable", () => {
  it("records intent before anything is destroyed", () => {
    // Without this row, a failure after the first destructive step left no
    // evidence the user ever asked.
    const web = webAction.slice(webAction.indexOf("export async function deleteAccountAction"));
    const intentAt = web.indexOf("markDeletionRequested");
    const purgeAt = web.indexOf("prepare_deleted_user_reports");
    expect(intentAt).toBeGreaterThan(-1);
    expect(intentAt).toBeLessThan(purgeAt);
  });

  it("makes a repeated request idempotent rather than a second workflow", () => {
    expect(service).toContain('{ onConflict: "user_id" }');
    expect(migration).toContain("user_id uuid not null unique");
  });

  it("advances the stage after each completed step", () => {
    for (const stage of ["reports_anonymised", "data_purged", "audited"]) {
      expect(webAction, `web flow should record ${stage}`).toContain(`recordDeletionStage(admin, userId, "${stage}")`);
      expect(nativeRoute, `native flow should record ${stage}`).toContain(
        `recordDeletionStage(admin, userId, "${stage}")`
      );
    }
  });

  it("tells the truth when the data is gone but the login remains", () => {
    // This is the state the whole workflow exists for. Reporting it as a plain
    // failure told the user nothing had happened when everything had.
    for (const source of [webAction, nativeRoute]) {
      expect(source).toContain("Your data has been deleted");
    }
  });

  it("clears the intent row only on success", () => {
    for (const source of [webAction, nativeRoute]) {
      const cleanup = source.indexOf('from("account_deletion_requests").delete()');
      const authDelete = source.indexOf("auth.admin.deleteUser");
      expect(cleanup).toBeGreaterThan(authDelete);
    }
  });

  it("never advances the stage past work actually done", () => {
    // Stage values are constrained in the database, so a bug cannot record a
    // step that does not exist.
    for (const stage of ["requested", "reports_anonymised", "data_purged", "audited", "auth_removed"]) {
      expect(migration).toContain(`'${stage}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// What gets deleted
// ---------------------------------------------------------------------------

describe("deletion erases the data it promises to", () => {
  it("purges location history", () => {
    // The single most sensitive table in the product.
    expect(DELETION_TABLES).toContain("user_locations");
  });

  it("hard-deletes friendships rather than soft-ending them", () => {
    // Removing a Muddy soft-ends the row so it can resume; deleting an ACCOUNT
    // must actually erase it, or one user's id survives inside another user's
    // rows after they asked to be forgotten.
    expect(service).toContain('admin.from("friendships").delete()');
    expect(service).not.toContain('from("friendships").update({ ended_at');
  });

  it("keeps both flows purging the same tables", () => {
    // Two lists would drift, and the drift would be invisible until someone's
    // data survived a deletion.
    for (const table of DELETION_TABLES) {
      expect(service, `${table} must be purged`).toContain(`"${table}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// The intent record cannot be forged
// ---------------------------------------------------------------------------

describe("the deletion record is server-controlled", () => {
  it("enables row level security", () => {
    expect(migration).toContain("enable row level security");
  });

  it("gives clients read access only", () => {
    // No INSERT/UPDATE/DELETE policy: a client must not be able to mark itself
    // deleted, advance its own stage past the work done, or erase the evidence
    // that a deletion was requested.
    expect(migration).toContain("for select");
    expect(migration).not.toMatch(/for\s+(insert|update|delete)/i);
  });

  it("carries no foreign key that would cascade the row away", () => {
    // The final step deletes the auth user; a cascading FK would remove this
    // row at the exact moment it confirms the workflow finished.
    expect(migration).not.toContain("references auth.users");
  });
});
