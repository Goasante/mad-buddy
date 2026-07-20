"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS
} from "@/lib/admin/support";
import { cn } from "@/lib/utils";

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting_for_user", label: "Waiting for user" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" }
];

const ANY = "";

const categoryOptions: AppSelectOption[] = [
  { value: ANY, label: "Any category" },
  ...SUPPORT_CATEGORIES.map((value) => ({ value, label: SUPPORT_CATEGORY_LABELS[value] }))
];
const priorityOptions: AppSelectOption[] = [
  { value: ANY, label: "Any priority" },
  ...SUPPORT_PRIORITIES.map((value) => ({ value, label: SUPPORT_PRIORITY_LABELS[value] }))
];

export type IssueFilterState = {
  statusKey: string;
  q: string;
  category: string;
  priority: string;
  assignee: string;
  platform: string;
  from: string;
  to: string;
};

export function IssueFilterBar({
  filters,
  assignees,
  platforms
}: {
  filters: IssueFilterState;
  assignees: { id: string; name: string }[];
  platforms: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(filters.q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apply(next: Partial<IssueFilterState>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any filter change returns to the first page.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}` as Route);
  }

  // Debounced server-side search (never a client-side filter).
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

  const assigneeOptions: AppSelectOption[] = [
    { value: ANY, label: "Any assignee" },
    { value: "unassigned", label: "Unassigned" },
    ...assignees.map((staff) => ({ value: staff.id, label: staff.name }))
  ];
  const platformOptions: AppSelectOption[] = [
    { value: ANY, label: "Any platform" },
    ...platforms.map((value) => ({ value, label: value }))
  ];

  const activeCount = [filters.category, filters.priority, filters.assignee, filters.platform, filters.from, filters.to]
    .filter(Boolean).length;
  const hasAny = activeCount > 0 || filters.q || filters.statusKey !== "all";

  const secondaryControls = (
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
        value={filters.priority || ANY}
        options={priorityOptions}
        placeholder="Any priority"
        onChange={(value) => apply({ priority: value })}
      />
      <AppSelect
        size="compact"
        value={filters.assignee || ANY}
        options={assigneeOptions}
        placeholder="Any assignee"
        searchable
        onChange={(value) => apply({ assignee: value })}
      />
      <AppSelect
        size="compact"
        value={filters.platform || ANY}
        options={platformOptions}
        placeholder="Any platform"
        onChange={(value) => apply({ platform: value })}
      />
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="issue-from">From date</label>
        <Input
          id="issue-from"
          type="date"
          value={filters.from}
          onChange={(event) => apply({ from: event.target.value })}
          className="h-10"
          aria-label="From date"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <label className="sr-only" htmlFor="issue-to">To date</label>
        <Input
          id="issue-to"
          type="date"
          value={filters.to}
          onChange={(event) => apply({ to: event.target.value })}
          className="h-10"
          aria-label="To date"
        />
      </div>
    </>
  );

  return (
    <div className="space-y-3">
      {/* Primary status filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const active = filters.statusKey === tab.key || (tab.key === "all" && !filters.statusKey);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => apply({ statusKey: tab.key === "all" ? "" : tab.key })}
              className={cn(
                "focus-ring shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={active}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search issues or users"
            aria-label="Search issues or users"
            className="pl-9"
          />
        </div>

        {/* Desktop: inline secondary filters. Mobile: bottom-sheet. */}
        <div className="hidden flex-wrap items-center gap-2 lg:flex">{secondaryControls}</div>

        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters{activeCount ? ` (${activeCount})` : ""}
        </Button>

        {hasAny ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              router.push(pathname as Route);
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      <Modal open={sheetOpen} onOpenChange={setSheetOpen} title="Filter issues" description="Narrow the queue by category, priority, assignee, platform, or date.">
        <div className="grid gap-3">{secondaryControls}</div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setSheetOpen(false)}>Done</Button>
        </div>
      </Modal>
    </div>
  );
}
