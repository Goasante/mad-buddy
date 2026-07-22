import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureOAuthAccountForUser } from "@/lib/auth/oauth-account";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type OrphanAuthAccount = {
  id: string;
  email: string | null;
  provider: string;
  createdAt: string;
  fullName: string | null;
};

/**
 * Auth accounts that exist in `auth.users` but have no `profiles` row. These
 * are otherwise INVISIBLE to the admin Users list (which is built from
 * `profiles`), so a sign-up whose profile bootstrap failed — e.g. an OAuth
 * exchange that succeeded but then errored creating the profile — would silently
 * vanish. Surfacing them here is the safeguard against that.
 *
 * Bounded: the auth admin API has no server-side join to `profiles`, so we page
 * through `listUsers` up to `cap` and diff against profile ids. Orphans are rare
 * and recent, so this stays cheap in practice.
 */
export async function listOrphanAuthAccounts(admin: Admin, cap = 2000): Promise<OrphanAuthAccount[]> {
  const authUsers = [];
  const perPage = 1000;
  for (let page = 1; authUsers.length < cap; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const batch = data?.users ?? [];
    authUsers.push(...batch);
    if (batch.length < perPage) break;
  }

  const { data: profiles } = await admin.from("profiles").select("user_id");
  const hasProfile = new Set((profiles ?? []).map((row) => row.user_id));

  return authUsers
    .filter((user) => !hasProfile.has(user.id))
    .map((user) => {
      const metadata = user.user_metadata ?? {};
      const fullName =
        (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
        (typeof metadata.name === "string" && metadata.name.trim()) ||
        null;
      return {
        id: user.id,
        email: user.email ?? null,
        provider: (user.app_metadata?.provider as string | undefined) ?? "unknown",
        createdAt: user.created_at,
        fullName
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export type BackfillResult = { ok: boolean; message: string };

/**
 * Create the missing profile (+ subscription + preferences) for an auth account,
 * reusing the exact idempotent path OAuth sign-in uses, so a backfilled account
 * is indistinguishable from one that bootstrapped correctly.
 */
export async function backfillProfileForAuthUser(admin: Admin, userId: string): Promise<BackfillResult> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return { ok: false, message: "That auth account no longer exists." };

  const { data: existing } = await admin.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing) return { ok: true, message: "This account already has a profile." };

  try {
    await ensureOAuthAccountForUser(data.user);
  } catch {
    return { ok: false, message: "Couldn't create the profile (the derived username may already be taken)." };
  }
  return { ok: true, message: "Profile created — the account now appears in the list." };
}
