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
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {meta}
        </div>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

type MetricTone = "default" | "success" | "warning" | "danger" | "orange";

const metricToneClassNames: Record<MetricTone, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-400",
  warning: "bg-amber-500/10 text-amber-400",
  danger: "bg-red-500/10 text-red-400",
  orange: "bg-orange-500/10 text-orange-400"
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
    <Card className={cn("h-full p-4", href && "safe-motion hover:border-primary/35 hover:bg-secondary/35")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", metricToneClassNames[tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );

  return href ? (
    <Link href={href as Route} className="focus-ring block h-full rounded-2xl" aria-label={`Open ${label}`}>
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
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {action}
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
    <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 px-5 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export function AdminQueryError({ message = "This data could not be loaded. Try again shortly." }: { message?: string }) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="alert">
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
  const dot = {
    default: "bg-muted-foreground",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400"
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/70 px-2.5 py-1 text-xs font-medium">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />
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
