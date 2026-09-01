import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  title,
  description,
  action,
  meta
}: {
  title: string;
  description: string;
  action?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] px-5 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.16)] sm:px-7 sm:py-7">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#E88C2B]/10 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 left-[18%] h-48 w-72 rounded-full bg-[#4E0401]/20 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 max-w-4xl">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d99b63]">Admin workspace</p>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[clamp(1.75rem,3vw,2.45rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-white">{title}</h1>
            {meta}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#aaa59f] sm:text-[15px]">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

type MetricTone = "default" | "success" | "warning" | "danger" | "orange";

const metricToneClassNames: Record<MetricTone, string> = {
  default: "border-white/[0.08] bg-white/[0.045] text-[#d8d3cc]",
  success: "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300",
  warning: "border-amber-400/15 bg-amber-400/[0.07] text-amber-300",
  danger: "border-red-400/15 bg-red-400/[0.07] text-red-300",
  orange: "border-[#E88C2B]/20 bg-[#E88C2B]/10 text-[#f2a253]"
};

export function AdminMetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  href
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  tone?: MetricTone;
  href?: string;
}) {
  const card = (
    <Card
      className={cn(
        "group relative h-full overflow-hidden rounded-[24px] border-white/[0.08] bg-[#111317]/88 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.14)]",
        href && "safe-motion hover:-translate-y-0.5 hover:border-[#E88C2B]/20 hover:bg-[#14161a] hover:shadow-[0_20px_55px_rgba(0,0,0,0.20)]"
      )}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8f8a84]">{label}</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-[-0.035em] text-white">{value}</p>
          {hint ? <p className="mt-1.5 text-xs leading-5 text-[#89847e]">{hint}</p> : null}
        </div>
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[15px] border", metricToneClassNames[tone])}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
      {href ? (
        <span className="pointer-events-none absolute bottom-0 left-0 h-px w-0 bg-[#E88C2B] transition-[width] duration-300 group-hover:w-full" aria-hidden="true" />
      ) : null}
    </Card>
  );

  return href ? (
    <Link href={href as Route} className="focus-ring block h-full rounded-[24px]" aria-label={`Open ${label}`}>
      {card}
    </Link>
  ) : card;
}

export function AdminSection({
  title,
  description,
  action,
  children,
  className
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#E88C2B] shadow-[0_0_0_4px_rgba(232,140,43,0.08)]" aria-hidden="true" />
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#f0ede8] sm:text-base">{title}</h2>
          </div>
          {description ? <p className="mt-1.5 max-w-3xl text-xs leading-5 text-[#89847e] sm:text-[13px]">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminEmptyState({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-[22px] border border-dashed border-white/[0.10] bg-white/[0.018] px-5 py-9 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-[15px] border border-white/[0.08] bg-white/[0.035] text-[#9d9892]">
        <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <p className="mt-3.5 text-sm font-semibold text-[#e8e4df]">{title}</p>
      <p className="mt-1.5 max-w-md text-xs leading-5 text-[#89847e]">{description}</p>
    </div>
  );
}

export function AdminQueryError({ message = "This data could not be loaded. Try again shortly." }: { message?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[18px] border border-amber-400/15 bg-amber-400/[0.06] px-4 py-3.5 text-sm leading-6 text-amber-100" role="alert">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
      {message}
    </div>
  );
}

export function AdminStatus({
  label,
  tone = "default"
}: {
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const tones = {
    default: "border-white/[0.09] bg-white/[0.035] text-[#b1aca6] [&>span]:bg-[#8c8781]",
    success: "border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-200 [&>span]:bg-emerald-400",
    warning: "border-amber-400/15 bg-amber-400/[0.06] text-amber-200 [&>span]:bg-amber-400",
    danger: "border-red-400/15 bg-red-400/[0.06] text-red-200 [&>span]:bg-red-400"
  }[tone];

  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold", tones)}>
      <span className="h-1.5 w-1.5 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.025)]" aria-hidden="true" />
      {label}
    </span>
  );
}

export function formatAdminDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {})
  }).format(new Date(value));
}

export function humanizeAdminValue(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
