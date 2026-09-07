import {
  Activity,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Compass,
  FileKey2,
  HeartHandshake,
  KeyRound,
  MapPinOff,
  MessageCircle,
  MessagesSquare,
  PartyPopper,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  UserRound,
  UsersRound,
  WandSparkles
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AdminMetricCard, AdminSection, AdminStatus } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import {
  SUPPORT_OPERATIONS_AREAS,
  supportCoverageCounts,
  type SupportCoverageState,
  type SupportOperationsArea
} from "@/lib/admin/support-operations-catalog";

const ICON_BY_AREA: Record<string, LucideIcon> = {
  "account-auth": KeyRound,
  "onboarding-activation": Sparkles,
  "profile-media": UserRound,
  "dob-age": ShieldCheck,
  "muddies-requests": UsersRound,
  "blocks-refriend": HeartHandshake,
  "direct-messaging": MessagesSquare,
  "plan-chat": MessageCircle,
  plans: CalendarCheck2,
  upfor: Activity,
  linkr: Compass,
  presence: MapPinOff,
  notifications: Bell,
  push: Smartphone,
  events: PartyPopper,
  "safe-arrival": ShieldCheck,
  "access-billing": CircleDollarSign,
  "features-tours": WandSparkles,
  journey: Sparkles,
  "privacy-account-ops": FileKey2
};

export function SupportOperationsCoverage() {
  const counts = supportCoverageCounts();

  return (
    <div className="space-y-5">
      <AdminSection
        title="Support operations coverage"
        description="The full Account Doctor scope in one place. This is an implementation map, not a claim that every repair already exists. ‘Live’ means the current branch has a usable operator path; ‘Partial’ means some diagnosis/repair capability exists; ‘Planned’ is deliberately not executable yet."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminMetricCard icon={Stethoscope} label="Product areas" value={counts.areas} hint="Founder-approved support coverage" tone="orange" />
          <AdminMetricCard icon={Activity} label="Live diagnosis" value={counts.diagnosticLive} hint="Areas with current Doctor checks" tone="success" />
          <AdminMetricCard icon={CheckCircle2} label="Live repairs" value={counts.repairLive} hint="Areas with executable repair paths" tone="success" />
          <AdminMetricCard icon={ShieldCheck} label="Planned end-to-end" value={counts.planned} hint="Areas still waiting for safe implementation" tone="default" />
        </div>
      </AdminSection>

      <div className="grid gap-3 xl:grid-cols-2">
        {SUPPORT_OPERATIONS_AREAS.map((area) => (
          <CoverageCard key={area.id} area={area} />
        ))}
      </div>
    </div>
  );
}

function CoverageCard({ area }: { area: SupportOperationsArea }) {
  const Icon = ICON_BY_AREA[area.id] ?? Stethoscope;

  return (
    <Card className="overflow-hidden rounded-[22px] border-white/[0.08] bg-[#111317]/88 shadow-[0_14px_38px_rgba(0,0,0,0.12)]">
      <details className="group">
        <summary className="focus-ring cursor-pointer list-none px-4 py-4 marker:hidden sm:px-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-white/[0.08] bg-white/[0.035] text-[#c7c1ba]">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[#f1eee9]">{area.label}</h3>
                <CoverageStatus label="Diagnose" state={area.diagnostic} />
                <CoverageStatus label="Repair" state={area.repair} />
                <CoverageStatus label="Verify" state={area.verification} />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8a84]">{area.description}</p>
            </div>
            <span className="mt-1 text-xs font-medium text-[#77736f] group-open:hidden">Details</span>
            <span className="mt-1 hidden text-xs font-medium text-[#d59a61] group-open:inline">Hide</span>
          </div>
        </summary>

        <div className="border-t border-white/[0.06] px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b867f]">Common support reports</p>
          <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {area.issues.map((issue) => (
              <li key={issue} className="flex items-start gap-2 text-xs leading-5 text-[#b6b0a9]">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#E88C2B]" aria-hidden="true" />
                {issue}
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-[16px] border border-[#E88C2B]/12 bg-[#E88C2B]/[0.045] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d49a62]">Safety boundary</p>
            <p className="mt-1 text-xs leading-5 text-[#a9a39c]">{area.boundary}</p>
          </div>
        </div>
      </details>
    </Card>
  );
}

function CoverageStatus({ label, state }: { label: string; state: SupportCoverageState }) {
  /* `by_design` reads as a deliberate answer rather than missing work: an
     operator scanning this map must not see "no repair here" and conclude
     somebody forgot to build one. */
  if (state === "by_design") {
    return <AdminStatus label={`${label}: none by design`} tone="default" />;
  }
  const tone = state === "live" ? "success" : state === "partial" ? "warning" : "default";
  return <AdminStatus label={`${label}: ${state}`} tone={tone} />;
}
