"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Lock } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { cn } from "@/lib/utils";
import { validateImageSelection } from "@/lib/media/validation";
import type { PickerWallpaper } from "@/lib/wallpapers/catalog";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import {
  applyCustomWallpaperAction,
  setWallpaperPreferenceAction,
  trackWallpaperPickerOpenedAction,
  uploadCustomWallpaperAction
} from "@/app/(app)/wallpaper-actions";

type WallpaperPickerData = {
  picker: PickerWallpaper[];
  selectedSlug: string;
  custom: { hasActive: boolean; thumbUrl: string | null; canUse: boolean };
};

const TIER_LABEL: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Plus",
  buddy_pro: "Pro"
};

export function WallpaperSettings({ data }: { data: WallpaperPickerData; plan: SubscriptionPlan }) {
  const router = useRouter();
  const [selected, setSelected] = useState(data.selectedSlug);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Picker-opened analytics (privacy-safe, no content). Fire once on mount.
  useEffect(() => {
    void trackWallpaperPickerOpenedAction();
  }, []);

  function choose(entry: PickerWallpaper) {
    if (isPending) return;
    if (entry.locked) return; // handled by the upgrade Link overlay
    const previous = selected;
    setSelected(entry.slug);
    setMessage(null);
    startTransition(async () => {
      const result = await setWallpaperPreferenceAction(entry.slug);
      if (!result.ok) {
        setSelected(previous);
        setMessage({ text: result.message, error: true });
        return;
      }
      router.refresh();
    });
  }

  function applyCustom() {
    if (isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await applyCustomWallpaperAction();
      if (!result.ok) {
        setMessage({ text: result.message, error: true });
        return;
      }
      setSelected("custom");
      router.refresh();
    });
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const clientError = validateImageSelection(file, "profile");
    if (clientError) {
      setMessage({ text: clientError, error: true });
      return;
    }
    setMessage(null);
    const formData = new FormData();
    formData.append("wallpaper", file);
    startTransition(async () => {
      const result = await uploadCustomWallpaperAction(formData);
      if (!result.ok) {
        setMessage({ text: result.message, error: true });
        return;
      }
      setSelected("custom");
      router.refresh();
    });
  }

  const customSelected = selected === "custom";

  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader
        title="Wallpaper"
        description="Choose the background behind Mad Buddy. It follows your account and switches with your theme."
      />

      {message ? (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            message.error
              ? "border-red-400/30 bg-red-400/10 text-red-700 dark:text-red-200"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200"
          )}
        >
          {message.text}
        </p>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold">Wallpapers</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.picker.map((entry) => (
            <WallpaperTile
              key={entry.slug}
              entry={entry}
              selected={selected === entry.slug}
              disabled={isPending}
              onChoose={() => choose(entry)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Custom</h2>
        <p className="mt-1 text-xs text-muted-foreground">Use one of your own photos as your wallpaper.</p>

        {data.custom.canUse ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {data.custom.hasActive && data.custom.thumbUrl ? (
              <button
                type="button"
                onClick={applyCustom}
                disabled={isPending}
                aria-pressed={customSelected}
                className={cn(
                  "focus-ring safe-motion relative aspect-[3/4] w-24 overflow-hidden rounded-xl border-2",
                  customSelected ? "border-primary" : "border-border/70 hover:border-border"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.custom.thumbUrl} alt="Your wallpaper" className="h-full w-full object-cover" />
                {customSelected ? <SelectedBadge /> : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
              className="focus-ring safe-motion flex aspect-[3/4] w-24 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
            >
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px] font-medium leading-tight">
                {isPending ? "Working…" : data.custom.hasActive ? "Replace" : "Use your photo"}
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onPickFile} />
          </div>
        ) : (
          <Link
            href="/upgrade"
            className="focus-ring safe-motion mt-3 flex max-w-xs items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-3 hover:bg-primary/[0.1]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                Use your own photo
                <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {/* The word PLUS is the badge. A 10px glyph beside it added
                      decoration, not meaning, in the AI/magic vocabulary being
                      removed product-wide. */}
                  PLUS
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Upgrade to set a personal wallpaper.</span>
            </span>
          </Link>
        )}
      </section>
    </div>
  );
}

function WallpaperTile({
  entry,
  selected,
  disabled,
  onChoose
}: {
  entry: PickerWallpaper;
  selected: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const inner = (
    <>
      <WallpaperPreview entry={entry} />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4">
        <span className="truncate text-[11px] font-medium text-white">{entry.name}</span>
        {entry.tier !== "free" ? (
          <span className="shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {TIER_LABEL[entry.requiredPlan]}
          </span>
        ) : null}
      </span>
      {selected ? <SelectedBadge /> : null}
      {entry.locked ? (
        <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/45 text-white">
          <Lock className="h-3 w-3" aria-hidden="true" />
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "focus-ring safe-motion relative block aspect-[3/4] overflow-hidden rounded-xl border-2 text-left",
    selected ? "border-primary" : "border-border/70 hover:border-border"
  );

  // A locked wallpaper routes to the existing upgrade flow rather than applying.
  if (entry.locked) {
    return (
      <Link href="/upgrade" aria-label={`${entry.name} — upgrade to unlock`} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={selected ? `${entry.name}, selected` : entry.name}
      className={className}
    >
      {inner}
    </button>
  );
}

function WallpaperPreview({ entry }: { entry: PickerWallpaper }) {
  if (entry.renderMode === "image" && entry.thumbUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={entry.thumbUrl} alt="" className="h-full w-full object-cover" aria-hidden="true" />;
  }
  if (entry.renderMode === "plain") {
    return <span className="block h-full w-full bg-background" aria-hidden="true" />;
  }
  // Ambient default — a soft branded preview (rings), not a literal render.
  return (
    <span className="relative block h-full w-full bg-background" aria-hidden="true">
      <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/25" />
      <span className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15" />
      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/40" />
    </span>
  );
}

function SelectedBadge() {
  return (
    <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}
