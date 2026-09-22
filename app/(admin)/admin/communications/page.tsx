import { redirect } from "next/navigation";
import { AtSign, MailPlus, Megaphone } from "lucide-react";
import { AdminCommunicationsForm } from "@/components/admin/admin-communications-form";
import { AdminEmailAliases } from "@/components/admin/admin-email-aliases";
import { AdminEmptyState, AdminPageHeader, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin/access";
import { BROADCAST_JOB_TYPE } from "@/lib/communications/broadcast";
import {
  cloudflareAliasConfigStatus,
  listMadBuddyEmailAliases,
  type MadBuddyEmailAlias
} from "@/lib/email/cloudflare-aliases";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CampaignSummary = {
  id: string;
  campaignName: string;
  subject: string;
  audience: string;
  kind: string;
  createdAt: string;
  sent: number;
  failed: number;
  skipped: number;
  statuses: Set<string>;
};

export default async function AdminCommunicationsPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  const { data: jobs, error } = await admin
    .from("jobs")
    .select("id, job_type, payload, status, created_at, completed_at, last_error_code")
    .eq("job_type", BROADCAST_JOB_TYPE)
    .order("created_at", { ascending: false })
    .limit(500);

  const campaigns = summarizeCampaigns(jobs ?? []);
  const aliasConfig = cloudflareAliasConfigStatus();
  let aliases: MadBuddyEmailAlias[] = [];
  let aliasLoadFailed = false;
  if (aliasConfig.configured) {
    try {
      aliases = await listMadBuddyEmailAliases();
    } catch {
      aliasLoadFailed = true;
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Communications"
        description="Send branded email announcements to selected Mad Buddy audiences and manage professional forwarding aliases."
        meta={<AdminStatus label="Email communications" tone="success" />}
      />

      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E88C2B]/20 bg-[#E88C2B]/10 text-[#E88C2B]">
            <MailPlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold">Compose broadcast</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Use this for downtime notices, feature launches, product updates, and community reminders. Optional campaigns respect each user&rsquo;s email preferences; essential service notices remain deliverable.
            </p>
          </div>
        </div>
        <AdminCommunicationsForm />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E88C2B]/20 bg-[#E88C2B]/10 text-[#E88C2B]">
              <AtSign className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold">Mad Buddy email aliases</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Create professional addresses such as press@mad-buddy.com or legal@mad-buddy.com. They use Cloudflare Email Routing and forward to the verified destination inbox.
              </p>
            </div>
          </div>
          {aliasLoadFailed ? <AdminStatus label="Cloudflare unavailable" tone="warning" /> : aliasConfig.configured ? <AdminStatus label="Cloudflare connected" tone="success" /> : <AdminStatus label="Setup required" tone="default" />}
        </div>
        <AdminEmailAliases aliases={aliases} configured={aliasConfig.configured && !aliasLoadFailed} />
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Recent broadcasts</h3>
            <p className="mt-1 text-xs text-muted-foreground">Delivery totals are aggregated across each campaign&rsquo;s background batches.</p>
          </div>
          {error ? <AdminStatus label="History unavailable" tone="warning" /> : null}
        </div>

        {!error && campaigns.length === 0 ? (
          <AdminEmptyState icon={Megaphone} title="No broadcasts yet" description="Your first queued mass email will appear here." />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-[minmax(240px,1.5fr)_150px_150px_100px_100px_120px] gap-4 border-b border-border/70 bg-secondary/25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
              <span>Campaign</span><span>Audience</span><span>Type</span><span>Sent</span><span>Failed</span><span>Status</span>
            </div>
            <div className="divide-y divide-border/70">
              {campaigns.map((campaign) => {
                const status = campaignStatus(campaign.statuses);
                return (
                  <div key={campaign.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(240px,1.5fr)_150px_150px_100px_100px_120px] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{campaign.campaignName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.subject}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Queued {formatAdminDate(campaign.createdAt)}</p>
                    </div>
                    <p className="text-xs"><span className="mr-2 font-medium text-muted-foreground md:hidden">Audience</span>{audienceLabel(campaign.audience)}</p>
                    <p className="text-xs"><span className="mr-2 font-medium text-muted-foreground md:hidden">Type</span>{kindLabel(campaign.kind)}</p>
                    <p className="text-xs font-semibold"><span className="mr-2 font-medium text-muted-foreground md:hidden">Sent</span>{campaign.sent}</p>
                    <p className="text-xs font-semibold"><span className="mr-2 font-medium text-muted-foreground md:hidden">Failed</span>{campaign.failed}</p>
                    <AdminStatus label={status.label} tone={status.tone} />
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

function summarizeCampaigns(rows: Array<{ payload: unknown; status: string; created_at: string }>) {
  const byCampaign = new Map<string, CampaignSummary>();

  for (const row of rows) {
    const payload = objectPayload(row.payload);
    if (!payload) continue;
    const id = text(payload.campaignId);
    if (!id) continue;

    let campaign = byCampaign.get(id);
    if (!campaign) {
      campaign = {
        id,
        campaignName: text(payload.campaignName) ?? "Untitled campaign",
        subject: text(payload.subject) ?? "No subject",
        audience: text(payload.audience) ?? "all_active",
        kind: text(payload.kind) ?? "product_update",
        createdAt: row.created_at,
        sent: 0,
        failed: 0,
        skipped: 0,
        statuses: new Set()
      };
      byCampaign.set(id, campaign);
    }

    campaign.sent += count(payload.sent);
    campaign.failed += count(payload.failed);
    campaign.skipped += count(payload.skipped);
    campaign.statuses.add(row.status);
    if (Date.parse(row.created_at) < Date.parse(campaign.createdAt)) campaign.createdAt = row.created_at;
  }

  return [...byCampaign.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20);
}

function campaignStatus(statuses: Set<string>): { label: string; tone: "default" | "success" | "warning" | "danger" } {
  if (statuses.has("dead_letter") || statuses.has("failed")) return { label: "Needs attention", tone: "danger" };
  if (statuses.has("processing") || statuses.has("retrying")) return { label: "Sending", tone: "warning" };
  if (statuses.has("queued") || statuses.has("scheduled")) return { label: "Queued", tone: "default" };
  return { label: "Completed", tone: "success" };
}

function audienceLabel(value: string) {
  return ({
    all_active: "All active",
    free: "Free",
    paid: "All paid",
    buddy_plus: "Buddy Plus",
    buddy_pro: "Buddy Pro"
  } as Record<string, string>)[value] ?? value;
}

function kindLabel(value: string) {
  return ({
    service_notice: "Service notice",
    product_update: "Product update",
    feature_launch: "Feature launch",
    community_reminder: "Reminder"
  } as Record<string, string>)[value] ?? value;
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
