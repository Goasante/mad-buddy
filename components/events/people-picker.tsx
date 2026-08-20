"use client";

import { useMemo, useState } from "react";
import { Check, Search, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

/**
 * Selection lists for Events -- reference panels 6A (invitees), 6C
 * (communities) and 9B (add admin).
 *
 * ONE component for all three because they are the same interaction: search a
 * list you already have, pick some rows, confirm with a count. Three separate
 * near-identical pickers is how the selected-state treatment drifts apart.
 *
 * The selection control is a drawn circle-and-tick, not an <input
 * type="checkbox">: a native checkbox cannot be sized to a comfortable touch
 * target or given the brand's selected treatment. The row itself carries
 * role="checkbox" with aria-checked, so assistive technology sees a real
 * multi-select regardless of how it is painted.
 */

export type PickerRow = {
  id: string;
  name: string;
  /** "@ama.m" for a person, "2.1K members" for a community. */
  secondary?: string | null;
  avatarUrl?: string | null;
};

function SelectionTick({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-transparent"
      )}
    >
      {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

export function PeoplePicker({
  rows,
  selectedIds,
  onToggle,
  onConfirm,
  searchPlaceholder,
  confirmLabel,
  /** Communities are pick-one; invitees and admins are pick-many. */
  single = false,
  emptyMessage,
  useAvatars = true,
  pending = false
}: {
  rows: PickerRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onConfirm: () => void;
  searchPlaceholder: string;
  /** Receives the live count so the button can read "Add 2 admins". */
  confirmLabel: (count: number) => string;
  single?: boolean;
  emptyMessage: string;
  useAvatars?: boolean;
  pending?: boolean;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.secondary].filter(Boolean).some((field) => (field as string).toLowerCase().includes(needle))
    );
  }, [rows, query]);

  const selected = new Set(selectedIds);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="pl-9"
        />
      </div>

      {/* The list scrolls, the confirm bar does not: on a 360px screen a
          non-scrolling list pushes the only way forward off the sheet. */}
      <div className="min-h-0 flex-1 overflow-y-auto" role={single ? "radiogroup" : "group"}>
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query ? "Nobody matches that." : emptyMessage}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {visible.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    role={single ? "radio" : "checkbox"}
                    aria-checked={isSelected}
                    onClick={() => onToggle(row.id)}
                    className={cn(
                      "flex min-h-[3.25rem] w-full items-center gap-3 px-1 py-2 text-left transition",
                      "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    )}
                  >
                    {useAvatars ? (
                      <UserAvatar name={row.name} src={row.avatarUrl ?? null} size="sm" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                        <Users2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-snug">{row.name}</span>
                      {row.secondary ? (
                        <span className="block truncate text-sm text-muted-foreground">{row.secondary}</span>
                      ) : null}
                    </span>
                    <SelectionTick selected={isSelected} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Disabled at zero rather than hidden: a button that vanishes leaves no
          clue about what the list is for. */}
      <Button
        className="w-full shrink-0"
        size="lg"
        disabled={selectedIds.length === 0 || pending}
        onClick={onConfirm}
      >
        {confirmLabel(selectedIds.length)}
      </Button>
    </div>
  );
}
