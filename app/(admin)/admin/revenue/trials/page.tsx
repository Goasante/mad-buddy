import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { AdminPageHeader, AdminQueryError, AdminSection, AdminStatus } from "@/components/admin/admin-ui";
import {
  TrialConfigForm,
  TrialGrantForm,
  TrialRevokeForm
} from "@/components/admin/revenue/trial-controls";
import { requireAdminPagePermission } from "@/lib/admin/access";

export const dynamic = "force-dynamic";

export default async function PremiumTrialsAdminPage() {
  const { admin, access } = await requireAdminPagePermission("admin.revenue.manage");
  if (access.role !== "owner") {
    return <AdminQueryError message="Only the Owner can manage premium trials." />;
  }
  const [configRes, trialsRes, eventsRes] = await Promise.all([
    admin.from("premium_trial_config").select("*").eq("key", "default").maybeSingle(),
    admin
      .from("premium_trials")
      .select("id, user_id, plan, status, source, trial_started_at, trial_ends_at, owner_override, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("premium_trial_events")
      .select("trial_id, event_type, feature_key, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(300)
  ]);
  if (configRes.error || trialsRes.error || eventsRes.error || !configRes.data) {
    return <AdminQueryError message="Trial controls could not be loaded. Apply the latest migration, then try again." />;
  }
  const userIds = [...new Set((trialsRes.data ?? []).map((trial) => trial.user_id))];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("user_id, username").in("user_id", userIds)
    : { data: [] };
  const usernames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]));
  const eventsByTrial = new Map<string, typeof eventsRes.data>();
  for (const event of eventsRes.data ?? []) {
    if (!event.trial_id) continue;
    const events = eventsByTrial.get(event.trial_id) ?? [];
    if (events.length < 6) events.push(event);
    eventsByTrial.set(event.trial_id, events);
  }
  const rules = configRes.data.eligibility_rules as {
    audience?: "all_eligible" | "owner_grant_only";
    minimum_account_age_days?: number;
    requires_completed_onboarding?: boolean;
  };

  return (
    <div className="space-y-8">
      <Link href="/admin/revenue" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Revenue
      </Link>
      <AdminPageHeader
        title="Premium trials"
        description="Configure one canonical trial offer, grant controlled exceptions, and inspect permanent lifecycle history."
        meta={<AdminStatus label={configRes.data.enabled ? "Enabled" : "Disabled"} tone={configRes.data.enabled ? "success" : "default"} />}
      />
      <AdminSection title="Trial configuration" description="Dates, plan, and eligibility are enforced by the server.">
        <TrialConfigForm
          enabled={configRes.data.enabled}
          plan={configRes.data.eligible_plan}
          durationDays={configRes.data.duration_days}
          audience={rules.audience ?? "all_eligible"}
          minimumAccountAgeDays={rules.minimum_account_age_days ?? 0}
          requiresCompletedOnboarding={rules.requires_completed_onboarding ?? true}
          campaignSource={configRes.data.campaign_source}
        />
      </AdminSection>
      <AdminSection title="Manual Owner grant" description="A reason is mandatory. Previous trial history remains intact.">
        <TrialGrantForm />
      </AdminSection>
      <AdminSection title="Trial history" description="Permanent records for active and ended trials.">
        <div className="divide-y divide-border/70">
          {(trialsRes.data ?? []).map((trial) => (
            <article key={trial.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="font-medium">{usernames.get(trial.user_id) ? `@${usernames.get(trial.user_id)}` : trial.user_id}</p>
                  <AdminStatus label={trial.status} tone={trial.status === "active" ? "success" : "default"} />
                  {trial.owner_override ? <AdminStatus label="Owner override" tone="warning" /> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {trial.plan.replace("_", " ")} · {new Date(trial.trial_started_at).toLocaleString()} to {new Date(trial.trial_ends_at).toLocaleString()} · {trial.source}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(eventsByTrial.get(trial.id) ?? [])
                    .map((event) => event.feature_key ? `${event.event_type} (${event.feature_key})` : event.event_type)
                    .join(" · ") || "No lifecycle events recorded"}
                </p>
              </div>
              {trial.status === "active" ? <TrialRevokeForm trialId={trial.id} /> : null}
            </article>
          ))}
          {!trialsRes.data?.length ? <p className="py-8 text-sm text-muted-foreground">No premium trials have been started.</p> : null}
        </div>
      </AdminSection>
    </div>
  );
}
