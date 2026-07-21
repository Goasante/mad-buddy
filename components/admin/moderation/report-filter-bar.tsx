"use client";

import { Search, X } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONTENT_REPORT_CATEGORIES,
  CONTENT_REPORT_CATEGORY_LABELS,
  CONTENT_REPORT_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
  USER_REPORT_STATUS_LABELS,
  type ReportKind
} from "@/lib/admin/moderation";
import { cn } from "@/lib/utils";

const ANY = "";

export type ReportFilterState = {
  source: ReportKind;
  status: string;
  category: string;
  type: string;
  q: string;
  from: string;
  to: string;
};

export function ReportFilterBar({ filters }: { filters: ReportFilterState }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(filters.q);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apply(next: Partial<ReportFilterState>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}` as Route);
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (term !== filters.q) apply({ q: term });
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const statusLabels = filters.source === "content" ? CONTENT_REPORT_STATUS_LABELS : USER_REPORT_STATUS_LABELS;
  const statusOptions: AppSelectOption[] = [
    { value: ANY, label: "Any status" },
    ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
  ];
  const categoryOptions: AppSelectOption[] = [
    { value: ANY, label: "Any category" },
    ...CONTENT_REPORT_CATEGORIES.map((value) => ({ value, label: CONTENT_REPORT_CATEGORY_LABELS[value] }))
  ];
  const typeOptions: AppSelectOption[] = [
    { value: ANY, label: "Any content type" },
    ...Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))
  ];

  const hasAny = filters.q || filters.status || filters.category || filters.type || filters.from || filters.to;

  return (
    <div className="space-y-3">
      {/* Source toggle — each source paginates/filters independently server-side. */}
      <div className="inline-flex rounded-lg border border-border/70 bg-card/60 p-1">
        {(["user", "content"] as ReportKind[]).map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => {
              // Switching source resets source-specific filters.
              const params = new URLSearchParams();
              params.set("source", source);
              router.push(`${pathname}?${params.toString()}` as Route);
            }}
            className={cn(
              "focus-ring rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors",
              filters.source === source ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={filters.source === source}
          >
            {source === "user" ? "User reports" : "Content reports"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search reports or users"
            aria-label="Search reports or users"
            className="pl-9"
          />
        </div>

        <AppSelect
          size="compact"
          value={filters.status || ANY}
          options={statusOptions}
          placeholder="Any status"
          onChange={(value) => apply({ status: value })}
        />

        {filters.source === "content" ? (
          <>
            <AppSelect
              size="compact"
              value={filters.category || ANY}
              options={categoryOptions}
              placeholder="Any category"
              searchable
              onChange={(value) => apply({ category: value })}
            />
            <AppSelect
              size="compact"
              value={filters.type || ANY}
              options={typeOptions}
              placeholder="Any content type"
              onChange={(value) => apply({ type: value })}
            />
          </>
        ) : null}

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="report-from">From date</label>
          <Input id="report-from" type="date" value={filters.from} onChange={(event) => apply({ from: event.target.value })} className="h-10" aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <label className="sr-only" htmlFor="report-to">To date</label>
          <Input id="report-to" type="date" value={filters.to} onChange={(event) => apply({ to: event.target.value })} className="h-10" aria-label="To date" />
        </div>

        {hasAny ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              const params = new URLSearchParams();
              params.set("source", filters.source);
              router.push(`${pathname}?${params.toString()}` as Route);
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" /> Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
