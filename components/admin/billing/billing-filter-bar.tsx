"use client";

import { Search, X } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLAN_LABELS, STATUS_LABELS } from "@/lib/admin/billing-admin";

const ANY = "";

export function BillingFilterBar({ filters }: { filters: { plan: string; status: string; q: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(filters.q);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apply(next: Record<string, string>) {
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

  const planOptions: AppSelectOption[] = [{ value: ANY, label: "Any plan" }, ...Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))];
  const statusOptions: AppSelectOption[] = [{ value: ANY, label: "Any status" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))];
  const hasAny = filters.q || filters.plan || filters.status;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search accounts" aria-label="Search accounts" className="pl-9" />
      </div>
      <AppSelect size="compact" value={filters.plan || ANY} options={planOptions} placeholder="Any plan" onChange={(value) => apply({ plan: value })} />
      <AppSelect size="compact" value={filters.status || ANY} options={statusOptions} placeholder="Any status" onChange={(value) => apply({ status: value })} />
      {hasAny ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => { setTerm(""); router.push(pathname as Route); }}>
          <X className="h-4 w-4" aria-hidden="true" /> Clear
        </Button>
      ) : null}
    </div>
  );
}
