import { redirect } from "next/navigation";

import { AccountStatusPage } from "@/components/settings/account-status-page";
import { isAppealable, type RestrictionType } from "@/lib/admin/governance";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRecord } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function SettingsAccountStatusPage() {
  const user = await getCurrentUserRecord();
  if (!user) redirect("/login");
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: restrictions } = await admin
    .from("user_restrictions")
    .select("id, restriction_type, starts_at, ends_at")
    .eq("user_id", user.id)
    .is("lifted_at", null)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("created_at", { ascending: false });
  const ids = (restrictions ?? []).map((row) => row.id);
  const { data: appeals } = ids.length
    ? await admin.from("appeals").select("source_restriction_id, status, decision").eq("subject_user_id", user.id).in("source_restriction_id", ids)
    : { data: [] };
  const appealByRestriction = new Map((appeals ?? []).map((row) => [row.source_restriction_id, row]));
  return <AccountStatusPage restrictions={(restrictions ?? []).map((row) => {
    const appeal = appealByRestriction.get(row.id);
    return {
      id: row.id,
      type: row.restriction_type,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      appealable: isAppealable(row.restriction_type as RestrictionType),
      appealStatus: appeal?.status ?? null,
      appealDecision: appeal?.decision ?? null
    };
  })} />;
}
