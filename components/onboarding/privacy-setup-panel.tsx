"use client";

import { Check, Eye, EyeOff, MapPin, ShieldCheck, X } from "lucide-react";
import { useState, useTransition } from "react";
import { recordPermissionResultAction, savePrivacySetupAction } from "@/app/(app)/onboarding-actions";
import { Button } from "@/components/ui/button";
import {
  FRIENDS_CAN_SEE,
  FRIENDS_NEVER_SEE,
  PERMISSION_DENIED_MESSAGE,
  SAFE_DEFAULT_PRIVACY_SETUP,
  type GlowAudience,
  type GlowDuration,
  type PermissionState
} from "@/lib/onboarding/rules";
import { cn } from "@/lib/utils";

const audiences: Array<{ id: GlowAudience; label: string; hint: string }> = [
  { id: "hidden", label: "Hidden", hint: "No one can see you. You can turn this on later." },
  { id: "close_friends", label: "Close Friends", hint: "Only the people you mark as close." },
  { id: "selected_circles", label: "Selected circles", hint: "Only circles you choose." },
  { id: "all_muddies", label: "All Muddies", hint: "Everyone you've approved." }
];

const durations: Array<{ id: GlowDuration; label: string }> = [
  { id: "1h", label: "1 hour" },
  { id: "4h", label: "4 hours" },
  { id: "until_tonight", label: "Until tonight" },
  { id: "until_off", label: "Until I turn it off" }
];

/**
 * Privacy Setup + location pre-permission education (spec §30-§49).
 *
 * Two rules this component exists to honour:
 *  - Glow starts Hidden. The user must actively choose otherwise (spec §31).
 *  - The browser permission prompt is never shown until AFTER the explanation
 *    and an explicit tap (spec §39, §40).
 */
export function PrivacySetupPanel({ onSaved }: { onSaved?: () => void }) {
  const [audience, setAudience] = useState<GlowAudience>(SAFE_DEFAULT_PRIVACY_SETUP.glowAudience);
  const [duration, setDuration] = useState<GlowDuration>(SAFE_DEFAULT_PRIVACY_SETUP.glowDuration);
  const [wavesFrom, setWavesFrom] = useState(SAFE_DEFAULT_PRIVACY_SETUP.wavesFrom);
  const [pingsFrom, setPingsFrom] = useState(SAFE_DEFAULT_PRIVACY_SETUP.pingsFrom);
  const [permission, setPermission] = useState<PermissionState>("not_requested");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const needsLocation = audience !== "hidden";

  function save() {
    startTransition(async () => {
      const result = await savePrivacySetupAction({
        glowAudience: audience,
        glowDuration: duration,
        wavesFrom,
        pingsFrom,
        onlineStatusVisible: false,
        contactMatchingEnabled: false
      });
      setFeedback(result.message);
      if (result.ok) onSaved?.();
    });
  }

  /** Only ever called from an explicit tap, after the explanation above it. */
  function requestLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setPermission("unsupported");
      void recordPermissionResultAction("unsupported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermission("granted");
        void recordPermissionResultAction("granted");
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        const next: PermissionState = denied ? "denied" : "error";
        setPermission(next);
        void recordPermissionResultAction(next);
      },
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold">Who can see your glow?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          You start hidden. Nothing is shared until you choose to turn it on.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {audiences.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAudience(option.id)}
              aria-pressed={audience === option.id}
              className={cn(
                "focus-ring safe-motion rounded-xl border p-3 text-left",
                audience === option.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {option.id === "hidden" ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {needsLocation ? (
        <section>
          <h3 className="text-sm font-semibold">For how long?</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {durations.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDuration(option.id)}
                aria-pressed={duration === option.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  duration === option.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* The honesty matrix — only claims that are technically true (spec §33). */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Friends may see</p>
          <ul className="mt-2 space-y-1">
            {FRIENDS_CAN_SEE.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-xs">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Friends never see</p>
          <ul className="mt-2 space-y-1">
            {FRIENDS_NEVER_SEE.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Who can reach you?</h3>
        <div className="mt-2 space-y-2">
          <PermissionRow
            label="Waves"
            value={wavesFrom}
            onChange={setWavesFrom}
            hint="A quick hello from a Muddy."
          />
          <PermissionRow
            label="Meeting Pings"
            value={pingsFrom}
            onChange={setPingsFrom}
            hint="Someone asking to meet up."
          />
        </div>
      </section>

      {/* Pre-permission education. The browser prompt only fires from the
          explicit button below, never on load (spec §39, §40). */}
      {needsLocation ? (
        <section className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            About location
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Mad Buddy uses your location to work out a broad proximity level between approved Muddies. Friends see
            labels like <strong>Around</strong> or <strong>Nearby</strong> — never a map, coordinates, direction or
            exact distance. Your browser will ask permission while you&apos;re using the app, and you can stop
            visibility at any time.
          </p>

          {permission === "granted" ? (
            <p className="mt-3 text-xs font-medium text-primary" role="status">
              Location is on. Your glow starts once your location updates.
            </p>
          ) : permission === "denied" || permission === "error" || permission === "unsupported" ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground" role="status">
                {permission === "unsupported"
                  ? "This browser doesn't support location. You can still use everything else."
                  : PERMISSION_DENIED_MESSAGE}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={requestLocation}>
                Try again
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={requestLocation}>
              Continue
            </Button>
          )}
        </section>
      ) : null}

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-xs leading-5 text-muted-foreground">
          You can review who can see you any time from Privacy. There&apos;s always a quick way to hide.
        </p>
      </div>

      <Button type="button" onClick={save} disabled={isPending} className="w-full">
        Save privacy settings
      </Button>
    </div>
  );
}

function PermissionRow({
  label,
  hint,
  value,
  onChange
}: {
  label: string;
  hint: string;
  value: "all_muddies" | "close_friends" | "nobody";
  onChange: (next: "all_muddies" | "close_friends" | "nobody") => void;
}) {
  const options: Array<{ id: typeof value; label: string }> = [
    { id: "all_muddies", label: "All Muddies" },
    { id: "close_friends", label: "Close Friends" },
    { id: "nobody", label: "Nobody" }
  ];
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-3">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={cn(
              "focus-ring safe-motion rounded-full border px-3 py-1 text-xs font-medium",
              value === option.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
