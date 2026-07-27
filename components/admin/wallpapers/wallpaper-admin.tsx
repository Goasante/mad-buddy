"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WallpaperAdminRow } from "@/lib/wallpapers/admin";
import {
  createWallpaperAction,
  setWallpaperEnabledAction,
  setWallpaperTierAction,
  updateWallpaperMetadataAction
} from "@/app/(admin)/admin/wallpapers/actions";

type Feedback = { text: string; error: boolean } | null;

const TIERS = [
  { value: "free", label: "Free" },
  { value: "buddy_plus", label: "Buddy Plus" },
  { value: "buddy_pro", label: "Buddy Pro" }
] as const;

export function WallpaperAdmin({ rows }: { rows: WallpaperAdminRow[] }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback({ text: result.message, error: !result.ok });
    });
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            feedback.error
              ? "border-red-400/30 bg-red-400/10 text-red-300"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      <CreateWallpaperForm disabled={isPending} onRun={run} />

      <div className="space-y-2">
        {rows.map((row) => (
          <Card key={row.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <WallpaperThumb row={row} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {row.name}
                  {!row.isEnabled ? <span className="ml-2 text-xs font-medium text-muted-foreground">(disabled)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.slug} · {row.renderMode} · {row.source}
                </p>
              </div>

              <label className="text-xs text-muted-foreground">
                Tier{" "}
                <select
                  value={row.tier}
                  disabled={isPending}
                  onChange={(event) =>
                    run(() => setWallpaperTierAction({ id: row.id, tier: event.target.value }))
                  }
                  className="ml-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                >
                  {TIERS.map((tier) => (
                    <option key={tier.value} value={tier.value}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </label>

              <SortOrderControl row={row} disabled={isPending} onRun={run} />

              <Button
                type="button"
                size="sm"
                variant={row.isEnabled ? "outline" : "primary"}
                disabled={isPending}
                onClick={() => run(() => setWallpaperEnabledAction({ id: row.id, isEnabled: !row.isEnabled }))}
              >
                {row.isEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WallpaperThumb({ row }: { row: WallpaperAdminRow }) {
  if (row.renderMode === "image" && row.thumbUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.thumbUrl} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover" aria-hidden="true" />;
  }
  return (
    <span className="grid h-12 w-9 shrink-0 place-items-center rounded-md border border-border/70 bg-secondary/40 text-[9px] font-medium text-muted-foreground">
      {row.renderMode === "plain" ? "Plain" : "MB"}
    </span>
  );
}

function SortOrderControl({
  row,
  disabled,
  onRun
}: {
  row: WallpaperAdminRow;
  disabled: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const [value, setValue] = useState(String(row.sortOrder));
  return (
    <label className="text-xs text-muted-foreground">
      Order{" "}
      <input
        type="number"
        value={value}
        min={0}
        max={9999}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const next = Number(value);
          if (Number.isFinite(next) && next !== row.sortOrder) {
            onRun(() => updateWallpaperMetadataAction({ id: row.id, sortOrder: next }));
          }
        }}
        className="ml-1 w-16 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
      />
    </label>
  );
}

function CreateWallpaperForm({
  disabled,
  onRun
}: {
  disabled: boolean;
  onRun: (action: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    renderMode: "image" as "ambient" | "plain" | "image",
    tier: "free" as "free" | "buddy_plus" | "buddy_pro",
    lightUrl: "",
    darkUrl: "",
    thumbUrl: "",
    sortOrder: "100"
  });

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Add wallpaper
      </Button>
    );
  }

  const field = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground";

  return (
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input className={field} placeholder="slug (e.g. aurora)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className={field} value={form.renderMode} onChange={(e) => setForm({ ...form, renderMode: e.target.value as typeof form.renderMode })}>
          <option value="image">Image</option>
          <option value="ambient">Ambient</option>
          <option value="plain">Plain</option>
        </select>
        <select className={field} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as typeof form.tier })}>
          {TIERS.map((tier) => (
            <option key={tier.value} value={tier.value}>
              {tier.label}
            </option>
          ))}
        </select>
        <input className={field} placeholder="Light image URL" value={form.lightUrl} onChange={(e) => setForm({ ...form, lightUrl: e.target.value })} />
        <input className={field} placeholder="Dark image URL" value={form.darkUrl} onChange={(e) => setForm({ ...form, darkUrl: e.target.value })} />
        <input className={field} placeholder="Thumbnail URL" value={form.thumbUrl} onChange={(e) => setForm({ ...form, thumbUrl: e.target.value })} />
        <input className={field} type="number" placeholder="Sort order" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={disabled}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onRun(() =>
              createWallpaperAction({
                slug: form.slug.trim(),
                name: form.name.trim(),
                renderMode: form.renderMode,
                tier: form.tier,
                lightUrl: form.lightUrl.trim(),
                darkUrl: form.darkUrl.trim(),
                thumbUrl: form.thumbUrl.trim(),
                sortOrder: Number(form.sortOrder) || 100
              })
            )
          }
        >
          Create
        </Button>
      </div>
    </Card>
  );
}
