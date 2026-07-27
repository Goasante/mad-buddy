import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  BadgeDollarSign,
  CircleDollarSign,
  CreditCard,
  Database,
  Landmark,
  Percent,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UsersRound
} from "lucide-react";
import { FinancialControls } from "@/components/admin/revenue/financial-controls";
import { AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, humanizeAdminValue } from "@/components/admin/admin-ui";
import { TrendChart } from "@/components/admin/overview/trend-chart";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";
import { getRevenueDashboard } from "@/lib/revenue/service";
import type { RevenueRangeDays } from "@/lib/revenue/revenue-intelligence";
import {
  R2_LIMITS_SOURCE,
  R2_PRESIGNED_URLS_SOURCE,
  R2_PRICING_SOURCE,
  R2_PRICING_VERIFIED_AT,
  R2_SCENARIO_ASSUMPTIONS,
  R2_SCENARIOS,
  R2_STANDARD_PRICING
} from "@/lib/revenue/r2-assessment";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ranges: RevenueRangeDays[] = [7, 30, 90, 365];

function parseRange(value?: string): RevenueRangeDays {
  const parsed = Number(value);
  return ranges.includes(parsed as RevenueRangeDays) ? parsed as RevenueRangeDays : 30;
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
}

function pct(value: number | null) {
  return value === null ? "Not enough data" : `${value}%`;
}

export default async function AdminRevenuePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { access } = await requireAdminPagePermission("admin.revenue.view");
  const range = parseRange((await searchParams).range);
  let data: Awaited<ReturnType<typeof getRevenueDashboard>> | null = null;
  let error = "";
  try {
    data = await getRevenueDashboard(range);
  } catch {
    error = "Revenue intelligence could not be loaded. Apply the latest database migration, then try again.";
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Revenue"
        description="Verified Paystack revenue, subscription health, conversion, premium value, and measured media usage. Currency totals are never combined."
        meta={<AdminStatus label="Server verified" tone="success" />}
      />

      <div className="flex rounded-xl border border-border/70 bg-card/60 p-1" aria-label="Revenue reporting period">
        {ranges.map((item) => (
          <Link
            key={item}
            href={{ pathname: "/admin/revenue", query: { range: String(item) } }}
            aria-current={item === range ? "page" : undefined}
            className={cn("focus-ring rounded-lg px-3 py-1.5 text-xs font-medium", item === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {item === 365 ? "12 months" : `${item} days`}
          </Link>
        ))}
      </div>

      {access.role === "owner" && access.permissions.has("admin.revenue.manage") ? (
        <div>
          <Link
            href={"/admin/revenue/trials" as Route}
            className="focus-ring inline-flex items-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Manage premium trials
          </Link>
        </div>
      ) : null}

      {!data ? <AdminQueryError message={error || "Revenue data is unavailable."} /> : <RevenueContent data={data} canManage={access.role === "owner" && access.permissions.has("admin.revenue.manage")} />}
    </div>
  );
}

function RevenueContent({ data, canManage }: { data: Awaited<ReturnType<typeof getRevenueDashboard>>; canManage: boolean }) {
  const { report } = data;
  return (
    <>
      {report.currencies.map((currency) => (
        <section key={currency.currency} className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{currency.currency} revenue</h2>
            <AdminStatus label="Reported separately" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <AdminMetricCard icon={CircleDollarSign} label="MRR" value={money(currency.mrrMinor, currency.currency)} hint="Current paid plans at configured monthly prices" tone="success" />
            <AdminMetricCard icon={TrendingUp} label="ARR run rate" value={money(currency.arrRunRateMinor, currency.currency)} hint="MRR × 12, not recognised annual revenue" />
            <AdminMetricCard icon={BadgeDollarSign} label="Collected revenue" value={money(currency.collectedMinor, currency.currency)} hint={`Verified charges in ${report.rangeDays} days`} tone="orange" />
            <AdminMetricCard icon={UsersRound} label="Paying users" value={currency.activePayingUsers} hint={`${currency.newPayingUsers} newly activated in range`} />
            <AdminMetricCard icon={CreditCard} label="ARPPU" value={currency.arppuMinor === null ? "Not enough data" : money(currency.arppuMinor, currency.currency)} hint="Collected revenue ÷ distinct payers" />
          </div>
          <AdminSection title="Collected revenue trend" description="Only verified successful Paystack charges are included.">
            <Card className="p-4">
              <TrendChart
                points={currency.dailyRevenue.map((point) => ({ label: point.date.slice(5), value: point.amountMinor / 100 }))}
                unitLabel={currency.currency}
                ariaLabel={`${currency.currency} collected revenue by day`}
              />
            </Card>
          </AdminSection>
        </section>
      ))}

      <UnitEconomicsSection data={data} />

      <RetentionSection data={data} />

      <ReconciliationSection data={data} />

      <BusinessAlertsSection data={data} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UsersRound} label="Active paid" value={report.current.activePayingUsers} hint={`${report.current.buddyPlusUsers} Plus · ${report.current.buddyProUsers} Pro`} />
        <AdminMetricCard icon={RefreshCw} label="In grace" value={report.current.graceUsers} hint={`${report.current.expiredGraceUsers} expired grace periods currently need attention`} tone={report.current.graceUsers ? "warning" : "default"} />
        <AdminMetricCard
          icon={TrendingDown}
          label="Subscription churn"
          value={data.lifecycleMovementsTrusted ? pct(report.lifecycle.subscriptionChurnPercent) : "Review required"}
          hint={
            data.lifecycleMovementsTrusted
              ? "Cancellations divided by active paid plus cancellations"
              : "Movement metrics are withheld until snapshots reconcile"
          }
          tone={data.lifecycleMovementsTrusted ? "default" : "warning"}
        />
        <AdminMetricCard icon={RefreshCw} label="Payment recovery" value={pct(report.lifecycle.recoveryRatePercent)} hint={`${report.lifecycle.recoveredPayments} recovered of ${report.lifecycle.failedPayments} failures`} />
      </section>

      <AdminSection title="Subscription funnel" description="Distinct authenticated users at trusted server boundaries. Active Free is the current free pool plus users activated during this period.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Stage</th><th className="px-4 py-3 text-right">Users</th><th className="px-4 py-3 text-right">From previous</th><th className="px-4 py-3 text-right">Drop-off</th></tr></thead>
            <tbody>{report.funnel.map((step) => <tr key={step.key} className="border-b border-border/50 last:border-0"><td className="px-4 py-3 font-medium">{step.label}</td><td className="px-4 py-3 text-right tabular-nums">{step.users}</td><td className="px-4 py-3 text-right text-muted-foreground">{pct(step.conversionPercent)}</td><td className="px-4 py-3 text-right text-muted-foreground">{pct(step.dropOffPercent)}</td></tr>)}</tbody>
          </table>
        </Card>
      </AdminSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <AdminSection title="Plan performance" description="Current users, product activity, verified revenue, and cancellation signals by plan.">
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Plan</th><th className="px-4 py-3 text-right">Users</th><th className="px-4 py-3 text-right">Active</th><th className="px-4 py-3 text-right">Actions</th><th className="px-4 py-3 text-right">Cancellations</th></tr></thead>
              <tbody>{report.plans.map((plan) => <tr key={plan.plan} className="border-b border-border/50 last:border-0"><td className="px-4 py-3 font-medium">{humanizeAdminValue(plan.plan)}</td><td className="px-4 py-3 text-right">{plan.users}</td><td className="px-4 py-3 text-right">{plan.activeUsers}</td><td className="px-4 py-3 text-right">{plan.featureActions}</td><td className="px-4 py-3 text-right">{data.lifecycleMovementsTrusted ? plan.cancellations : "Review required"}</td></tr>)}</tbody>
            </table>
          </Card>
        </AdminSection>
        <AdminSection
          title="Subscription movement"
          description={
            data.lifecycleMovementsTrusted
              ? `Reconciled lifecycle movement during the selected ${report.rangeDays}-day period.`
              : "Lifecycle movement is withheld because one or more snapshots require reconciliation."
          }
        >
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            <LifecycleValue label="Upgrades" value={data.lifecycleMovementsTrusted ? report.lifecycle.upgrades : "Review required"} />
            <LifecycleValue label="Downgrades" value={data.lifecycleMovementsTrusted ? report.lifecycle.downgrades : "Review required"} />
            <LifecycleValue label="Cancellations" value={data.lifecycleMovementsTrusted ? report.lifecycle.cancellations : "Review required"} />
            <LifecycleValue label="Failed payments" value={report.lifecycle.failedPayments} />
            <LifecycleValue label="Recovered payments" value={report.lifecycle.recoveredPayments} />
            <LifecycleValue label="Gross revenue retention" value="Not enough data" />
          </Card>
        </AdminSection>
      </div>

      <AdminSection title="Feature usage by plan" description="Usage is grouped by the subscription snapshot stored with each product event. Differences are correlations, not proof that a feature caused conversion.">
        <Card className="overflow-x-auto p-0">
          {report.featurePlans.length ? <table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Feature</th><th className="px-4 py-3 text-right">Free users</th><th className="px-4 py-3 text-right">Plus users</th><th className="px-4 py-3 text-right">Pro users</th><th className="px-4 py-3 text-right">Actions/user F · P · Pro</th></tr></thead><tbody>{report.featurePlans.map((feature) => <tr key={feature.featureKey} className="border-b border-border/50 last:border-0"><td className="px-4 py-3 font-medium">{humanizeAdminValue(feature.featureKey)}</td><td className="px-4 py-3 text-right">{feature.freeUsers}</td><td className="px-4 py-3 text-right">{feature.plusUsers}</td><td className="px-4 py-3 text-right">{feature.proUsers}</td><td className="px-4 py-3 text-right text-muted-foreground">{feature.freeActionsPerUser} · {feature.plusActionsPerUser} · {feature.proActionsPerUser}</td></tr>)}</tbody></table> : <p className="p-5 text-sm text-muted-foreground">No feature activity was recorded in this period.</p>}
        </Card>
      </AdminSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <AdminSection title="Before conversion" description="Share of newly paid users who used each feature on or before their activation day. Correlation only.">
          <Card className="divide-y divide-border/60 p-0">
            {report.conversionAssociations.length ? report.conversionAssociations.slice(0, 10).map((row) => <div key={row.featureKey} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span>{humanizeAdminValue(row.featureKey)}</span><span className="text-right tabular-nums text-muted-foreground">{row.usersWithFeatureBeforeConversion}/{row.convertedUsers} · {pct(row.percent)}</span></div>) : <p className="p-5 text-sm text-muted-foreground">No conversion associations are available yet.</p>}
          </Card>
        </AdminSection>
        <AdminSection title="Invite to paid" description="Secure invite signups matched to server-verified subscription activations.">
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            <LifecycleValue label="Invited users" value={report.inviteAttribution.invitedUsers} />
            <LifecycleValue label="Activated invited users" value={report.inviteAttribution.activatedInvitedUsers} />
            <LifecycleValue label="Paid invited users" value={report.inviteAttribution.paidInvitedUsers} />
            <LifecycleValue label="Invite to paid" value={pct(report.inviteAttribution.inviteToPaidPercent)} />
          </Card>
        </AdminSection>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <AdminSection title="Cancellation reasons" description="Optional reasons collected without adding friction to cancellation.">
          <Card className="divide-y divide-border/60 p-0">
            {data.cancellationReasons.length ? data.cancellationReasons.map((row) => <div key={row.reason} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span>{row.reason}</span><span className="tabular-nums text-muted-foreground">{row.count}</span></div>) : <p className="p-5 text-sm text-muted-foreground">No cancellation reasons were collected in this period.</p>}
          </Card>
        </AdminSection>
        <AdminSection title="Entitlement performance" description="Entitled-user counts are authoritative. Direct per-entitlement usage is unavailable until each premium action emits its own event.">
          <Card className="max-h-[360px] divide-y divide-border/60 overflow-y-auto p-0">
            {data.entitlementPerformance.map((row) => <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><div><p className="font-medium">{humanizeAdminValue(row.key)}</p><p className="text-xs text-muted-foreground">{row.plans.map(humanizeAdminValue).join(", ") || "No plan"}</p></div><div className="text-right"><p className="font-medium tabular-nums">{row.entitledUsers}</p><p className="text-xs text-muted-foreground">Usage unavailable</p></div></div>)}
          </Card>
        </AdminSection>
      </div>

      <AdminSection title="Signup cohort revenue" description="Forward-looking paid conversion and verified 30/90-day revenue. Recent cohorts remain explicitly ineligible until they mature.">
        <Card className="overflow-x-auto p-0">
          {data.cohorts.length ? <table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Signup week</th><th className="px-4 py-3 text-right">Users</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Conversion</th><th className="px-4 py-3 text-right">30-day revenue</th><th className="px-4 py-3 text-right">90-day revenue</th></tr></thead><tbody>{data.cohorts.map((row) => <tr key={row.cohortWeek} className="border-b border-border/50 last:border-0"><td className="px-4 py-3 font-medium">{row.cohortWeek}</td><td className="px-4 py-3 text-right">{row.users}</td><td className="px-4 py-3 text-right">{row.paidUsers}</td><td className="px-4 py-3 text-right">{pct(row.paidConversionPercent)}</td><td className="px-4 py-3 text-right text-muted-foreground">{row.eligible30Users ? formatCurrencyMap(row.revenue30ByCurrency) : "Not mature"}</td><td className="px-4 py-3 text-right text-muted-foreground">{row.eligible90Users ? formatCurrencyMap(row.revenue90ByCurrency) : "Not mature"}</td></tr>)}</tbody></table> : <p className="p-5 text-sm text-muted-foreground">No signup cohorts are available in this period.</p>}
        </Card>
      </AdminSection>

      <ProviderCostsSection data={data} />
      {canManage ? <AdminSection title="Owner financial controls" description="Every manual cost, alert change, snapshot, and reconciliation request is permission-checked, rate-limited, and audited."><FinancialControls initialRules={data.businessAlertRules} /></AdminSection> : null}
      <InfrastructureSection data={data} />
      <R2Assessment monitoring={data.r2Monitoring} />

      <Card className="border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-5 text-muted-foreground">
        Financial snapshots and fee coverage begin after the financial-intelligence migration is deployed. Earlier subscription state is not reconstructed. Contribution margin includes only verified payment fees and recorded infrastructure costs; it is not profit.
      </Card>
    </>
  );
}

function UnitEconomicsSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  return <AdminSection title="Unit economics" description="Verified payments and recorded provider costs only. Contribution is not profit and excludes unrecorded salaries, taxes, marketing, legal, and other operating costs.">
    {data.unitEconomics.length ? <div className="space-y-4">{data.unitEconomics.map((row) => <Card key={row.currency} className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{row.currency}</h3><AdminStatus label={row.feeUnavailableCount === 0 ? "Fees verified" : `${row.feeUnavailableCount} fee${row.feeUnavailableCount === 1 ? "" : "s"} unavailable`} tone={row.feeUnavailableCount === 0 ? "success" : "warning"} /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LifecycleValue label="Gross collected" value={money(row.grossCollectedMinor, row.currency)} />
        <LifecycleValue label="Payment fees" value={row.feeTransactionCount ? money(row.paymentFeesMinor, row.currency) : "Fee unavailable"} />
        <LifecycleValue label="Net collected" value={row.netCollectedMinor === null ? "Not enough data" : money(row.netCollectedMinor, row.currency)} />
        <LifecycleValue label="Recorded infrastructure" value={row.infrastructureCostMinor === null ? "Cost data unavailable" : money(row.infrastructureCostMinor, row.currency)} />
        <LifecycleValue label="Revenue per active user" value={row.revenuePerActiveUserMinor === null ? "Not enough data" : money(row.revenuePerActiveUserMinor, row.currency)} />
        <LifecycleValue label="ARPPU" value={row.arppuMinor === null ? "Not enough data" : money(row.arppuMinor, row.currency)} />
        <LifecycleValue label="Cost per paying user" value={row.infrastructureCostPerPayingUserMinor === null ? "Not enough data" : money(row.infrastructureCostPerPayingUserMinor, row.currency)} />
        <LifecycleValue label="Recorded-cost contribution" value={row.recordedCostContributionMinor === null ? "Not enough data" : money(row.recordedCostContributionMinor, row.currency)} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{row.activeUsers} active users in this reporting window. Provider costs use complete billing-period records that overlap the selected range and are not prorated.</p>
    </Card>)}</div> : <Card className="p-5 text-sm text-muted-foreground">No verified payments or provider costs are available for this period.</Card>}
  </AdminSection>;
}

function RetentionSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  return (
    <AdminSection
      title="Revenue retention"
      description="GRR = (opening MRR minus contraction and churn) divided by opening MRR. NRR adds expansion and reactivation. New MRR is excluded. Unreconciled months publish no movement or retention metrics."
    >
      <Card className="overflow-x-auto p-0">
        {data.monthlyRetention.length ? (
          <table className="w-full min-w-[1060px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Integrity</th>
                <th className="px-4 py-3 text-right">Opening</th>
                <th className="px-4 py-3 text-right">New</th>
                <th className="px-4 py-3 text-right">Expansion</th>
                <th className="px-4 py-3 text-right">Reactivation</th>
                <th className="px-4 py-3 text-right">Contraction</th>
                <th className="px-4 py-3 text-right">Churned</th>
                <th className="px-4 py-3 text-right">GRR</th>
                <th className="px-4 py-3 text-right">NRR</th>
              </tr>
            </thead>
            <tbody>
              {data.monthlyRetention.slice(0, 24).map((row) => (
                <tr key={`${row.month}:${row.currency}`} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 font-medium">{row.month}</td>
                  <td className="px-4 py-3">{row.currency}</td>
                  <td className="px-4 py-3">
                    <AdminStatus
                      label={
                        row.reconciliationStatus === "reconciled"
                          ? "Reconciled"
                          : row.reconciliationStatus === "reconciliation_required"
                            ? "Review required"
                            : "Not enough data"
                      }
                      tone={
                        row.reconciliationStatus === "reconciled"
                          ? "success"
                          : row.reconciliationStatus === "reconciliation_required"
                            ? "warning"
                            : "default"
                      }
                    />
                  </td>
                  <MoneyCell value={row.openingMrrMinor} currency={row.currency} />
                  <MoneyCell value={row.newMrrMinor} currency={row.currency} />
                  <MoneyCell value={row.expansionMrrMinor} currency={row.currency} />
                  <MoneyCell value={row.reactivationMrrMinor} currency={row.currency} />
                  <MoneyCell value={row.contractionMrrMinor} currency={row.currency} />
                  <MoneyCell value={row.churnedMrrMinor} currency={row.currency} />
                  <td className="px-4 py-3 text-right">{pct(row.grrPercent)}</td>
                  <td className="px-4 py-3 text-right">{pct(row.nrrPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">
            Not enough data. Daily snapshots start after deployment and are never reconstructed from current state.
          </p>
        )}
      </Card>
    </AdminSection>
  );
}

function ReconciliationSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  if (!data.reconciliationIssues.length) return null;
  return (
    <AdminSection
      title="Snapshot reconciliation"
      description="Trusted opening and ending MRR are preserved. Movement labels, GRR, NRR, and lifecycle-derived cancellation alerts remain withheld until the event difference is reviewed."
    >
      <Card className="border-amber-500/25 bg-amber-500/[0.05] p-0">
        <div className="flex gap-3 border-b border-amber-500/20 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Financial reconciliation required</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              This diagnostic contains only dates, currencies, and aggregate minor-unit differences. It contains no user, transaction, or payment-secret data.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3">Snapshot</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3 text-right">Trusted opening</th>
                <th className="px-4 py-3 text-right">Trusted ending</th>
                <th className="px-4 py-3 text-right">Event difference</th>
                <th className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliationIssues.map((snapshot) => (
                <tr
                  key={`${snapshot.snapshotDate}:${snapshot.currency}`}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="px-4 py-3 font-medium">{snapshot.snapshotDate}</td>
                  <td className="px-4 py-3">{snapshot.currency}</td>
                  <td className="px-4 py-3 text-right">
                    {snapshot.openingMrrMinor === null
                      ? "Not available"
                      : money(snapshot.openingMrrMinor, snapshot.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(snapshot.endingMrrMinor, snapshot.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {snapshot.reconciliationDifferenceMinor === null
                      ? "Not available"
                      : money(snapshot.reconciliationDifferenceMinor, snapshot.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Lifecycle movements do not match trusted MRR.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminSection>
  );
}

function MoneyCell({ value, currency }: { value: number | null; currency: string }) {
  return (
    <td className="px-4 py-3 text-right">
      {value === null ? "Not enough data" : money(value, currency)}
    </td>
  );
}

function BusinessAlertsSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  return <AdminSection title="Business alerts" description="Quiet, threshold-based comparisons. No statistical anomaly-detection claim is made.">
    {data.businessAlerts.length ? <div className="grid gap-3 md:grid-cols-2">{data.businessAlerts.map((alert) => <Card key={alert.key} className={cn("flex gap-3 p-4", alert.severity === "critical" ? "border-red-500/25 bg-red-500/[0.06]" : "border-amber-500/25 bg-amber-500/[0.06]")}><AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", alert.severity === "critical" ? "text-red-400" : "text-amber-400")} aria-hidden="true" /><div><p className="text-sm font-semibold">{alert.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{alert.detail}</p></div></Card>)}</div> : <Card className="p-5 text-sm text-muted-foreground">No configured threshold has been crossed. Rules with insufficient comparison data stay silent.</Card>}
  </AdminSection>;
}

function ProviderCostsSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  return <AdminSection title="Provider costs" description="Owner-entered invoice, API, or manual records. These are operational inputs, not accounting statements.">
    <Card className="overflow-x-auto p-0">
      {data.providerCosts.length ? <table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Period</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Source</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody>{data.providerCosts.map((cost) => <tr key={cost.id} className="border-b border-border/50 last:border-0"><td className="px-4 py-3">{cost.billingPeriod.slice(0, 7)}</td><td className="px-4 py-3 font-medium">{cost.provider}</td><td className="px-4 py-3 text-muted-foreground">{humanizeAdminValue(cost.category)}</td><td className="px-4 py-3 text-muted-foreground">{humanizeAdminValue(cost.source)}</td><td className="px-4 py-3 text-right tabular-nums">{money(cost.amountMinor, cost.currency)}</td></tr>)}</tbody></table> : <p className="p-5 text-sm text-muted-foreground">Cost data unavailable. The Owner can record trusted monthly provider totals after deployment.</p>}
    </Card>
  </AdminSection>;
}

function LifecycleValue({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-secondary/45 px-3 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}

function InfrastructureSection({ data }: { data: Awaited<ReturnType<typeof getRevenueDashboard>> }) {
  const media = data.mediaStorage;
  const bytes = media.reduce((sum, row) => sum + row.originalBytes + row.variantBytes, 0);
  const objects = media.reduce((sum, row) => sum + row.objects, 0);
  const feeTransactions = data.unitEconomics.reduce((sum, row) => sum + row.feeTransactionCount, 0);
  const missingFees = data.unitEconomics.reduce((sum, row) => sum + row.feeUnavailableCount, 0);
  const feeCoverage = feeTransactions + missingFees > 0 ? Math.round((feeTransactions / (feeTransactions + missingFees)) * 1000) / 10 : null;
  return <AdminSection title="Infrastructure and media" description="Measured application usage is shown separately from unavailable vendor billing data.">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <AdminMetricCard icon={Database} label="Tracked private media" value={formatBytes(bytes)} hint={`${objects.toLocaleString()} ready media records and variants`} />
      <AdminMetricCard icon={Landmark} label="Provider cost records" value={data.providerCosts.length} hint="Trusted monthly records entered by the Owner" />
      <AdminMetricCard icon={ReceiptText} label="Verified Paystack fees" value={feeTransactions} hint={`${missingFees} successful payment fee${missingFees === 1 ? "" : "s"} unavailable`} />
      <AdminMetricCard icon={Percent} label="Fee coverage" value={feeCoverage === null ? "Not enough data" : `${feeCoverage}%`} hint="Successful payments with an authoritative fee" />
    </div>
    <Card className="mt-3 overflow-x-auto p-0">
      {media.length ? <table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Context</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Objects</th><th className="px-4 py-3 text-right">Stored bytes</th></tr></thead><tbody>{media.map((row) => <tr key={`${row.contextType}:${row.contentType}`} className="border-b border-border/50 last:border-0"><td className="px-4 py-3">{humanizeAdminValue(row.contextType)}</td><td className="px-4 py-3 text-muted-foreground">{row.contentType}</td><td className="px-4 py-3 text-right">{row.objects}</td><td className="px-4 py-3 text-right">{formatBytes(row.originalBytes + row.variantBytes)}</td></tr>)}</tbody></table> : <p className="p-5 text-sm text-muted-foreground">No ready private media is currently measured. Public avatar-bucket bytes require provider usage data.</p>}
    </Card>
  </AdminSection>;
}

function R2Assessment({ monitoring }: { monitoring: Awaited<ReturnType<typeof getRevenueDashboard>>["r2Monitoring"] }) {
  return <AdminSection title="Cloudflare R2 assessment" description={`Migration status: ${monitoring.status}. Strategic recommendation remains LATER. Pricing verified ${R2_PRICING_VERIFIED_AT}; no migration has been performed.`}>
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2"><AdminStatus label={monitoring.status} tone={monitoring.status === "RECOMMENDED" ? "warning" : monitoring.status === "REVIEW" ? "warning" : "success"} /><span className="text-xs text-muted-foreground">Tracked private media: {formatBytes(monitoring.storedBytes)}. Review at {formatBytes(monitoring.reviewAtBytes)}; recommend at {formatBytes(monitoring.recommendAtBytes)}. Provider bandwidth and read counts remain unavailable.</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LifecycleValue label="Standard storage" value={`$${R2_STANDARD_PRICING.storageUsdPerGbMonth}/GB-month`} />
        <LifecycleValue label="Class A" value={`$${R2_STANDARD_PRICING.classAUsdPerMillion}/million`} />
        <LifecycleValue label="Class B" value={`$${R2_STANDARD_PRICING.classBUsdPerMillion}/million`} />
        <LifecycleValue label="Internet egress" value="No R2 egress fee" />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Monthly Standard free tier: 10 GB-month, 1 million Class A operations, and 10 million Class B operations. R2 is not unlimited free. Presigned URLs are bearer tokens and work on the S3 API domain, not custom domains.</p>
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-border/70 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Users</th><th className="px-4 py-3 text-right">Storage</th><th className="px-4 py-3 text-right">Writes/month</th><th className="px-4 py-3 text-right">Reads/month</th><th className="px-4 py-3 text-right">R2-only estimate</th></tr></thead><tbody>{R2_SCENARIOS.map((scenario) => <tr key={scenario.users} className="border-b border-border/50 last:border-0"><td className="px-4 py-3 font-medium">{scenario.users.toLocaleString()}</td><td className="px-4 py-3 text-right">{scenario.storageGb} GB</td><td className="px-4 py-3 text-right">{scenario.classAOperations.toLocaleString()}</td><td className="px-4 py-3 text-right">{scenario.classBOperations.toLocaleString()}</td><td className="px-4 py-3 text-right">${scenario.estimatedMonthlyUsd.toFixed(2)}/month</td></tr>)}</tbody></table>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Assumptions per user: {R2_SCENARIO_ASSUMPTIONS.profileMbPerUser} MB profile, {R2_SCENARIO_ASSUMPTIONS.activeMomentImageMbPerUser} MB active Moment images, {R2_SCENARIO_ASSUMPTIONS.activeMomentVideoMbPerUser} MB active Moment video, {R2_SCENARIO_ASSUMPTIONS.classAWritesPerUserMonth} writes and {R2_SCENARIO_ASSUMPTIONS.classBReadsPerUserMonth} reads monthly. Estimates exclude Workers, image transforms, video transcoding, malware scanning, and operational work.</p>
      <div className="flex flex-wrap gap-4 text-xs"><a className="text-primary hover:underline" href={R2_PRICING_SOURCE} target="_blank" rel="noreferrer">Official pricing</a><a className="text-primary hover:underline" href={R2_LIMITS_SOURCE} target="_blank" rel="noreferrer">Official limits</a><a className="text-primary hover:underline" href={R2_PRESIGNED_URLS_SOURCE} target="_blank" rel="noreferrer">Presigned URL security</a></div>
    </Card>
  </AdminSection>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatCurrencyMap(values: Record<string, number>) {
  const entries = Object.entries(values);
  return entries.length ? entries.map(([currency, value]) => money(value, currency)).join(" · ") : "No revenue";
}
