import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

export function PageShell({ children, className }: PageShellProps) {
  return <div className={cn("space-y-4 sm:space-y-5", className)}>{children}</div>;
}

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, subtitle, action, className }: PageHeaderProps) {
  return (
    <section className={cn("glass-panel rounded-[1.25rem] p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-3">{eyebrow}</div> : null}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}

type SectionProps = {
  children: ReactNode;
  className?: string;
};

export function Section({ children, className }: SectionProps) {
  return <section className={cn("glass-panel rounded-[1.25rem] p-4 sm:p-5", className)}>{children}</section>;
}

type ContentGridProps = {
  children: ReactNode;
  className?: string;
};

export function ContentGrid({ children, className }: ContentGridProps) {
  return <div className={cn("grid gap-4", className)}>{children}</div>;
}

type ActionBarProps = {
  children: ReactNode;
  className?: string;
};

export function ActionBar({ children, className }: ActionBarProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      {children}
    </div>
  );
}
