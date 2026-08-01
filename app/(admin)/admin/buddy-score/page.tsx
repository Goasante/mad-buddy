import { Activity, ShieldCheck } from "lucide-react";
import { BuddyScoreCorrectionForm } from "@/components/admin/buddy-score-correction-form";
import { EarnedRewardRevokeForm } from "@/components/admin/earned-reward-revoke-form";
import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminBuddyScorePage() {
  const { admin } = await requireAdminPagePermission("admin.buddy_score.manage");
  const [result, rewardsResult] = await Promise.all([
    admin.from("buddy_score_ledger").select("id,user_id,event_type,points_delta,rule_version,created_at").order("created_at", { ascending: false }).limit(100),
    admin.from("earned_premium_rewards").select("id,user_id,reward_plan,source_score_snapshot,status,granted_at,expires_at,grace_ends_at,revoked_at,revoke_reason").order("granted_at", { ascending: false }).limit(100)
  ]);
  const rows = result.data ?? [];
  const rewards = rewardsResult.data ?? [];
  const userIds = [...new Set([...rows.map((row) => row.user_id), ...rewards.map((row) => row.user_id)])];
  const profiles = userIds.length ? await admin.from("profiles").select("user_id,full_name,username").in("user_id", userIds) : { data: [] };
  const profileMap = new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile]));

  return <div className="space-y-7">
    <AdminPageHeader title="Buddy Score" description="Review the immutable score ledger and add audited corrections. Existing history is never edited." meta={<AdminStatus label="Server authored" tone="success" />} />
    <AdminSection title="Audited correction" description="Corrections require a reason and create both a ledger event and an admin audit record."><BuddyScoreCorrectionForm /></AdminSection>
    <AdminSection title="Score ledger" description="Recent versioned events from trusted application activity.">
      {result.error ? <AdminQueryError /> : rows.length === 0 ? <AdminEmptyState icon={Activity} title="No score activity" description="Trusted score events will appear after users complete eligible activity." /> : <Card className="divide-y divide-border/70 overflow-hidden p-0">{rows.map((row) => { const profile = profileMap.get(row.user_id); return <div key={row.id} className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium">{profile?.full_name ?? "Mad Buddy user"} <span className="text-muted-foreground">@{profile?.username ?? row.user_id.slice(0, 8)}</span></p><p className="mt-1 text-xs text-muted-foreground">{humanizeAdminValue(row.event_type)} / rule v{row.rule_version} / {formatAdminDate(row.created_at, true)}</p></div><AdminStatus label={`Rule v${row.rule_version}`} tone="default" /><span className={row.points_delta >= 0 ? "text-sm font-semibold text-emerald-400" : "text-sm font-semibold text-red-400"}>{row.points_delta > 0 ? "+" : ""}{row.points_delta}</span></div>; })}</Card>}
    </AdminSection>
    <AdminSection title="Earned premium history" description="Temporary Plus and Pro access stays separate from paid subscriptions.">
      {rewardsResult.error ? <AdminQueryError /> : rewards.length === 0 ? <AdminEmptyState icon={ShieldCheck} title="No earned rewards" description="Qualified earned access will appear here." /> : <Card className="divide-y divide-border/70 overflow-hidden p-0">{rewards.map((reward) => { const profile = profileMap.get(reward.user_id); const isOpen = reward.status === "active" || reward.status === "grace"; return <div key={reward.id} className="grid gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto_auto_minmax(250px,auto)] lg:items-center"><div><p className="text-sm font-medium">{profile?.full_name ?? "Mad Buddy user"} <span className="text-muted-foreground">@{profile?.username ?? reward.user_id.slice(0, 8)}</span></p><p className="mt-1 text-xs text-muted-foreground">Score snapshot {reward.source_score_snapshot} / granted {formatAdminDate(reward.granted_at, true)} / ends {formatAdminDate(reward.grace_ends_at ?? reward.expires_at, true)}</p>{reward.revoke_reason ? <p className="mt-1 text-xs text-red-300">Reason: {reward.revoke_reason}</p> : null}</div><AdminStatus label={humanizeAdminValue(reward.reward_plan)} tone={reward.status === "active" ? "success" : reward.status === "grace" ? "warning" : "default"} /><AdminStatus label={humanizeAdminValue(reward.status)} />{isOpen ? <EarnedRewardRevokeForm rewardId={reward.id} /> : <span className="text-xs text-muted-foreground">History retained</span>}</div>; })}</Card>}
    </AdminSection>
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/35 p-4 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" /><p>Reports alone never create penalties. Negative changes require a confirmed moderation outcome or an audited correction.</p></div>
  </div>;
}
