import Link from "next/link";
import { Activity, CalendarDays, Repeat2, Sparkles, UsersRound } from "lucide-react";
import { AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus } from "@/components/admin/admin-ui";
import { TrendChart } from "@/components/admin/overview/trend-chart";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { getProductAnalyticsReport } from "@/lib/analytics/service";
import type {
  AnalyticsPlanFilter,
  AnalyticsRangeDays,
  FeaturePerformance,
  ProductAnalyticsReport
} from "@/lib/analytics/product-analytics";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ranges: AnalyticsRangeDays[] = [7, 30, 90];
const plans: Array<{ value: AnalyticsPlanFilter; label: string }> = [
  { value: "all", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "buddy_plus", label: "Buddy Plus" },
  { value: "buddy_pro", label: "Buddy Pro" }
];

function parseRange(value: string | undefined): AnalyticsRangeDays {
  const parsed = Number(value);
  return ranges.includes(parsed as AnalyticsRangeDays) ? (parsed as AnalyticsRangeDays) : 30;
}

function parsePlan(value: string | undefined): AnalyticsPlanFilter {
  return plans.some((plan) => plan.value === value) ? (value as AnalyticsPlanFilter) : "all";
}

function filterHref(range: AnalyticsRangeDays, plan: AnalyticsPlanFilter) {
  return { pathname: "/admin/analytics", query: { range: String(range), plan } };
}

function pct(value: number | null) {
  return value === null ? "Not enough data" : `${value}%`;
}

export default async function AdminAnalyticsPage({
  searchParams
}: {
  searchParams: Promise<{ range?: string; plan?: string }>;
}) {
  await requireAdminPagePermission("admin.analytics.view");
  const query = await searchParams;
  const range = parseRange(query.range);
  const plan = parsePlan(query.plan);
  let report: ProductAnalyticsReport | null = null;
  let loadError = "";
  try {
    report = await getProductAnalyticsReport(range, plan);
  } catch {
    loadError = "Analytics could not be loaded. Apply the latest database migration, then try again.";
  }

  return (
    <div className="space-y-7">
      <AdminPageHeader
        title="Product analytics"
        description="Privacy-safe activation, meaningful activity, retention, and feature performance. No message content, exact location, or private profile details are collected."
        meta={<AdminStatus label="UTC reporting" tone="default" />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-border/70 bg-card/60 p-1" aria-label="Reporting period">
          {ranges.map((item) => (
            <Link
              key={item}
              href={filterHref(item, plan)}
              aria-current={item === range ? "page" : undefined}
              className={cn("focus-ring rounded-lg px-3 py-1.5 text-xs font-medium", item === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {item} days
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap rounded-xl border border-border/70 bg-card/60 p-1" aria-label="Subscription plan">
          {plans.map((item) => (
            <Link
              key={item.value}
              href={filterHref(range, item.value)}
              aria-current={item.value === plan ? "page" : undefined}
              className={cn("focus-ring rounded-lg px-3 py-1.5 text-xs font-medium", item.value === plan ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <nav className="flex gap-4 overflow-x-auto border-b border-border/70 text-sm" aria-label="Analytics sections">
        {["Overview", "Activation", "Retention", "Features", "Cohorts"].map((label) => (
          <a key={label} href={`#${label.toLowerCase()}`} className="focus-ring shrink-0 border-b-2 border-transparent px-1 pb-2 text-muted-foreground hover:border-primary/50 hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      {loadError || !report ? (
        <AdminQueryError message={loadError || "Analytics are unavailable."} />
      ) : (
        <AnalyticsContent report={report} />
      )}
    </div>
  );
}

function AnalyticsContent({ report }: { report: ProductAnalyticsReport }) {
  return (
    <>
      <section id="overview" className="scroll-mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AdminMetricCard icon={Activity} label="Daily active users" value={report.dau} hint="Meaningful activity today" />
          <AdminMetricCard icon={UsersRound} label="Weekly active users" value={report.wau} hint="Last 7 UTC days" />
          <AdminMetricCard icon={CalendarDays} label="Monthly active users" value={report.mau} hint="Last 30 UTC days" />
          <AdminMetricCard icon={Repeat2} label="DAU / MAU" value={pct(report.dauMauRatio)} hint="Frequency, not user quality" />
          <AdminMetricCard icon={Sparkles} label="Signup cohort" value={report.trackedUsers} hint={`Created in this ${report.rangeDays}-day view`} />
        </div>
        <AdminSection title="Meaningful daily activity" description="Distinct users who completed a trusted social action. Page loads are excluded.">
          <Card className="p-4">
            <TrendChart points={report.dailyActiveUsers.map((point) => ({ label: point.date.slice(5), value: point.users }))} unitLabel="active users" ariaLabel="Meaningful daily active users" />
          </Card>
        </AdminSection>
      </section>

      <AdminSection
        title="Activation"
        description="Signup → setup → connection → interaction → return. Each conversion compares with the previous step."
        className="scroll-mt-6"
      >
        <div id="activation" className="grid gap-3 lg:grid-cols-3">
          {report.funnel.map((step) => (
            <Card key={step.key} className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{step.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{step.count}</p>
              <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                <span>{step.conversionPercent}% converted</span>
                <span>{step.dropOffPercent}% drop-off</span>
              </div>
            </Card>
          ))}
        </div>
      </AdminSection>

      <AdminSection
        title="Retention"
        description="Exact-day retention: a signup is retained only when meaningful activity occurs on UTC day 1, 7, or 30 after signup."
        className="scroll-mt-6"
      >
        <div id="retention" className="grid gap-3 sm:grid-cols-3">
          {report.retention.map((metric) => (
            <Card key={metric.day} className="p-4">
              <p className="text-sm font-semibold">D{metric.day} retention</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{pct(metric.percent)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{metric.retainedUsers} of {metric.eligibleUsers} eligible users</p>
            </Card>
          ))}
        </div>
      </AdminSection>

      <AdminSection
        title="Feature performance"
        description="Usage and retention association. Association is correlation only and does not establish causation."
        className="scroll-mt-6"
      >
        <div id="features" className="overflow-x-auto rounded-2xl border border-border/70">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-secondary/35 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-3 py-3 font-medium">Users</th>
                <th className="px-3 py-3 font-medium">Actions</th>
                <th className="px-3 py-3 font-medium">Actions/user</th>
                <th className="px-3 py-3 font-medium">7-day trend</th>
                <th className="px-3 py-3 font-medium">30-day trend</th>
                <th className="px-3 py-3 font-medium">D7 with / without</th>
                <th className="px-3 py-3 font-medium">Association</th>
                <th className="px-4 py-3 font-medium">Flag status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {report.features.map((feature) => <FeatureRow key={feature.key} feature={feature} />)}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <AdminSection title="Signup cohorts" description="Users grouped by signup week. Recent cohorts show unavailable periods rather than false zeroes." className="scroll-mt-6">
        <div id="cohorts" className="overflow-x-auto rounded-2xl border border-border/70">
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="bg-secondary/35 text-xs text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">Cohort week</th><th className="px-4 py-3 font-medium">Users</th><th className="px-4 py-3 font-medium">D1</th><th className="px-4 py-3 font-medium">D7</th><th className="px-4 py-3 font-medium">D30</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {report.cohorts.length ? report.cohorts.map((cohort) => (
                <tr key={cohort.cohortWeek}>
                  <td className="px-4 py-3 font-medium">Week of {cohort.cohortWeek}</td>
                  <td className="px-4 py-3 tabular-nums">{cohort.users}</td>
                  <td className="px-4 py-3 tabular-nums">{pct(cohort.d1)}</td>
                  <td className="px-4 py-3 tabular-nums">{pct(cohort.d7)}</td>
                  <td className="px-4 py-3 tabular-nums">{pct(cohort.d30)}</td>
                </tr>
              )) : <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No signup cohorts in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <p className="text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()} · Cached for up to five minutes.</p>
    </>
  );
}

function trendLabel(value: number | null) {
  if (value === null) return "New activity";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function FeatureRow({ feature }: { feature: FeaturePerformance }) {
  const association = {
    higher: "Associated with higher retention",
    lower: "Associated with lower retention",
    similar: "Similar retention",
    insufficient: "Not enough data"
  }[feature.retentionAssociation];
  return (
    <tr>
      <td className="px-4 py-3 font-medium">{feature.title}</td>
      <td className="px-3 py-3 tabular-nums">{feature.activeUsers}</td>
      <td className="px-3 py-3 tabular-nums">{feature.totalActions}</td>
      <td className="px-3 py-3 tabular-nums">{feature.actionsPerUser}</td>
      <td className="px-3 py-3"><span className="block tabular-nums">{feature.sevenDayActions}</span><span className="text-muted-foreground">{trendLabel(feature.sevenDayTrendPercent)}</span></td>
      <td className="px-3 py-3"><span className="block tabular-nums">{feature.thirtyDayActions}</span><span className="text-muted-foreground">{trendLabel(feature.thirtyDayTrendPercent)}</span></td>
      <td className="px-3 py-3 tabular-nums">{pct(feature.d7WithFeature)} / {pct(feature.d7WithoutFeature)}</td>
      <td className="max-w-44 px-3 py-3 text-muted-foreground">{association}</td>
      <td className="px-4 py-3"><AdminStatus label={feature.flagStatus} tone={feature.flagStatus === "Disabled" ? "warning" : "default"} /></td>
    </tr>
  );
}
