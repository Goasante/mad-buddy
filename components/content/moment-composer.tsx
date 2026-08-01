"use client";

import { ArrowLeft, CakeSlice, Check, Crown, Globe2, ImagePlus, LockKeyhole, Users, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createMomentAction, uploadMomentMediaAction } from "@/app/(app)/moments-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  audienceSummaryLabel,
  EXPIRY_PRESETS,
  MOMENT_CAPTION_MAX_LENGTH,
  type ExpiryPresetId
} from "@/lib/content/moments";
import { detectLocationRisk, LOCATION_WARNING_MESSAGE } from "@/lib/content/safety";
import { validateImageSelection, validateImageSource } from "@/lib/media/validation";
import { compressImageForUpload, MAX_SOURCE_IMAGE_BYTES } from "@/lib/media/client-compress";
import type { MomentAudienceType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { spotlightUpgradeCopy } from "@/lib/billing/upgrade-copy";
import { TuneInIcon } from "@/components/content/tune-in-icon";
import { birthdayMomentCaption } from "@/lib/profile/birthday-experience";

export type MomentMuddyOption = { id: string; name: string; avatarUrl: string | null };

type Step = "image" | "details" | "review";

/**
 * Create a Moment: image → details → review.
 *
 * IMAGE ONLY, for this phase. The Moment schema still supports text and video
 * and existing posts of those kinds keep rendering, but nothing here can produce
 * one, so no new text-only or video Moment is created.
 *
 * The composer never closes itself on failure: everything the user picked and
 * typed stays put so a rejected publish is one tap from retrying.
 */
export function MomentComposer({
  open,
  muddies,
  spotlightEnabled,
  canPublishSpotlight,
  closeFriendsAvailable,
  birthdayTemplateAvailable,
  onOpenChange,
  onPublished
}: {
  open: boolean;
  muddies: MomentMuddyOption[];
  spotlightEnabled: boolean;
  /** Resolved SERVER-side from the canonical entitlement. Presentation only. */
  canPublishSpotlight: boolean;
  closeFriendsAvailable: boolean;
  birthdayTemplateAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>("image");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<MomentAudienceType>("all_muddies");
  const [selectedMuddies, setSelectedMuddies] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryPresetId>("6h");
  const [spotlightConfirmed, setSpotlightConfirmed] = useState(false);
  const [birthdayTemplateApplied, setBirthdayTemplateApplied] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [error, setError] = useState("");
  const [isUploading, startUpload] = useTransition();
  const [isPublishing, startPublish] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const isSpotlight = audience === "public";
  const risk = detectLocationRisk(caption);
  const preset = EXPIRY_PRESETS.find((option) => option.id === expiry);

  function reset() {
    setStep("image");
    setMediaId(null);
    setPreview(null);
    setCaption("");
    setAudience("all_muddies");
    setSelectedMuddies([]);
    setExpiry("6h");
    setSpotlightConfirmed(false);
    setBirthdayTemplateApplied(false);
    setShowUpgrade(false);
    setError("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function clearPickers() {
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function upload(file: File) {
    // Images only: a video file is refused here rather than silently accepted.
    if (file.type.startsWith("video/")) {
      setError("Moments are photos for now. Choose an image.");
      clearPickers();
      return;
    }
    // The SOURCE is validated on format and a generous bound only. A big camera
    // photo is fine input; the byte cap applies after compression, which is why
    // an ordinary phone photo no longer gets rejected outright.
    const sourceError = validateImageSource(file, "moment", MAX_SOURCE_IMAGE_BYTES);
    if (sourceError) {
      setError(sourceError);
      clearPickers();
      return;
    }

    // Local preview first so the image appears immediately.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPreview(reader.result);
    };
    reader.readAsDataURL(file);

    startUpload(async () => {
      const compressed = await compressImageForUpload(file);
      if (!compressed.ok) {
        // A real, actionable reason rather than a bare size complaint.
        setPreview(null);
        setError(compressed.reason);
        clearPickers();
        return;
      }

      // The post-compression file still has to satisfy the server cap; if it
      // somehow does not, say so before spending an upload round trip.
      const uploadError = validateImageSelection(compressed.file, "moment");
      if (uploadError) {
        setPreview(null);
        setError(uploadError);
        clearPickers();
        return;
      }

      const formData = new FormData();
      formData.set("media", compressed.file);
      // The server still re-encodes with sharp (which is what actually strips
      // EXIF, since a client can be bypassed) and still builds thumb/feed.
      const result = await uploadMomentMediaAction(formData);
      if (result.ok && result.mediaId) {
        setMediaId(result.mediaId);
        setError("");
        setStep("details");
      } else {
        setPreview(null);
        setError(result.message);
      }
      clearPickers();
    });
  }

  function publish() {
    startPublish(async () => {
      const result = await createMomentAction({
        contentType: "photo",
        mediaId: mediaId ?? undefined,
        caption: caption.trim() || undefined,
        audienceType: audience,
        targetIds: audience === "selected_muddies" ? selectedMuddies : undefined,
        publicAudienceConfirmed: isSpotlight ? spotlightConfirmed : undefined,
        expiresAt: new Date(Date.now() + (preset?.ms ?? 0)).toISOString(),
        birthdayTemplate: birthdayTemplateApplied
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onPublished(result.locationWarning ? `${result.message} ${result.locationWarning}` : result.message);
      reset();
      onOpenChange(false);
    });
  }

  const detailsReady =
    mediaId !== null &&
    (audience !== "selected_muddies" || selectedMuddies.length > 0) &&
    (!isSpotlight || canPublishSpotlight);
  const canPublish = detailsReady && (!isSpotlight || (spotlightConfirmed && !risk.warn));

  const audienceOptions: { id: MomentAudienceType; label: string; hint: string; icon: typeof Users }[] = [
    { id: "all_muddies", label: "All Muddies", hint: "Everyone in your Muddy list", icon: Users },
    { id: "selected_muddies", label: "Selected Muddies", hint: "Pick specific Muddies", icon: Users },
    ...(closeFriendsAvailable
      ? [{ id: "close_friends" as const, label: "Close Friends", hint: "Your close circle", icon: LockKeyhole }]
      : [])
  ];

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={step === "image" ? "Share a Moment" : step === "details" ? "Add details" : "Review"}
      variant="sheet"
      compact
      footer={
        <div className="w-full space-y-2">
          {error ? (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
          {step === "details" ? (
            <Button type="button" className="w-full" disabled={!detailsReady} onClick={() => setStep("review")}>
              Next: Review
            </Button>
          ) : step === "review" ? (
            <Button type="button" className="w-full" disabled={!canPublish || isPublishing} onClick={publish}>
              {isPublishing ? "Sharing…" : isSpotlight ? "Go On Air" : "Share Moment"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {step === "image" ? (
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Moments are photos that disappear. Choose one to get started.
            </p>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <button
              type="button"
              disabled={isUploading}
              onClick={() => cameraRef.current?.click()}
              className="focus-ring safe-motion flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 text-left hover:bg-secondary"
            >
              <ImagePlus className="h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />
              <span className="text-sm font-semibold">Take a photo</span>
            </button>
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileRef.current?.click()}
              className="focus-ring safe-motion flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 text-left hover:bg-secondary"
            >
              <ImagePlus className="h-5 w-5 shrink-0 text-violet-500" aria-hidden="true" />
              <span className="text-sm font-semibold">Choose from library</span>
            </button>
            {isUploading ? (
              <p className="text-xs text-muted-foreground" role="status">
                Optimising your photo…
              </p>
            ) : null}
          </div>
        ) : null}

        {step !== "image" ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
            <img
              src={preview ?? ""}
              alt="Your Moment"
              className="aspect-square w-full rounded-[1rem] bg-secondary/40 object-cover"
            />
            {step === "details" ? (
              <button
                type="button"
                onClick={() => {
                  setMediaId(null);
                  setPreview(null);
                  setStep("image");
                }}
                aria-label="Replace photo"
                className="focus-ring safe-motion absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/75"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        {step === "details" ? (
          <>
            {birthdayTemplateAvailable ? (
              <button
                type="button"
                onClick={() => {
                  setCaption(birthdayMomentCaption());
                  setBirthdayTemplateApplied(true);
                }}
                aria-pressed={birthdayTemplateApplied}
                className={cn(
                  "focus-ring safe-motion flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left",
                  birthdayTemplateApplied
                    ? "border-amber-400/60 bg-amber-400/10"
                    : "border-border bg-card/60 hover:bg-secondary"
                )}
              >
                <CakeSlice className="h-4 w-4 text-amber-500" aria-hidden="true" />
                <span className="text-sm font-semibold">Use birthday template</span>
              </button>
            ) : null}
            <div>
              <label htmlFor="moment-caption" className="mb-1.5 block text-sm font-semibold">
                Caption <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="moment-caption"
                value={caption}
                maxLength={MOMENT_CAPTION_MAX_LENGTH}
                rows={2}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Say something about it"
              />
              {risk.warn ? (
                // The canonical warning copy. The tripped signals are telemetry
                // only and are deliberately never shown verbatim.
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">{LOCATION_WARNING_MESSAGE}</p>
              ) : null}
            </div>

            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Private</p>
              <div className="mt-1.5 space-y-1.5">
                {audienceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAudience(option.id)}
                    aria-pressed={audience === option.id}
                    className={cn(
                      "focus-ring safe-motion flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left",
                      audience === option.id
                        ? "border-violet-400/50 bg-violet-400/10"
                        : "border-border bg-card/60 hover:bg-secondary"
                    )}
                  >
                    <option.icon className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{option.label}</span>
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">{option.hint}</span>
                    </span>
                    {audience === option.id ? (
                      <Check className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>

              {audience === "selected_muddies" ? (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto overscroll-contain">
                  {muddies.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">Add Muddies first.</p>
                  ) : (
                    muddies.map((muddy) => {
                      const picked = selectedMuddies.includes(muddy.id);
                      return (
                        <button
                          key={muddy.id}
                          type="button"
                          aria-pressed={picked}
                          onClick={() =>
                            setSelectedMuddies((current) =>
                              current.includes(muddy.id)
                                ? current.filter((id) => id !== muddy.id)
                                : [...current, muddy.id]
                            )
                          }
                          className={cn(
                            "focus-ring safe-motion flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-2.5 text-left",
                            picked ? "border-violet-400/50 bg-violet-400/10" : "border-border hover:bg-secondary"
                          )}
                        >
                          <UserAvatar src={muddy.avatarUrl} name={muddy.name} size="xs" decorative />
                          <span className="min-w-0 flex-1 truncate text-sm">{muddy.name}</span>
                          <span className="sr-only">{picked ? "Selected" : "Not selected"}</span>
                          {picked ? (
                            <Check className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            {spotlightEnabled ? (
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Public</p>
                <button
                  type="button"
                  aria-pressed={isSpotlight}
                  onClick={() => {
                    // Never a silently greyed row: a non-entitled tap explains
                    // what Spotlight is and routes to the existing upgrade flow.
                    if (!canPublishSpotlight) {
                      setShowUpgrade(true);
                      return;
                    }
                    setAudience("public");
                  }}
                  className={cn(
                    "focus-ring safe-motion mt-1.5 flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left",
                    isSpotlight ? "border-orange-400/50 bg-orange-400/12" : "border-border bg-card/60 hover:bg-secondary"
                  )}
                >
                  <Globe2 className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      Air
                      {!canPublishSpotlight ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-400/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-200">
                          <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                          Premium
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[0.6875rem] text-muted-foreground">
                      Public across Mad Buddy
                    </span>
                  </span>
                  {isSpotlight ? <Check className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" /> : null}
                </button>

                {showUpgrade ? <SpotlightUpgradeNote /> : null}
              </div>
            ) : null}

            <div>
              <p className="mb-1.5 text-sm font-semibold">Expires in</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Expires in">
                {EXPIRY_PRESETS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={expiry === option.id}
                    onClick={() => setExpiry(option.id)}
                    className={cn(
                      "focus-ring safe-motion min-h-10 flex-1 rounded-xl border px-2 text-xs font-semibold",
                      expiry === option.id
                        ? "border-orange-400/50 bg-orange-500 text-white"
                        : "border-border bg-card/60 text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {option.id}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {step === "review" ? (
          <>
            {caption.trim() ? <p className="text-sm leading-6">{caption.trim()}</p> : null}
            <dl className="divide-y divide-border/60 rounded-[1rem] border border-border/70 bg-card/60 px-4">
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="shrink-0 text-xs text-muted-foreground">Audience</dt>
                <dd className="min-w-0 truncate text-sm font-semibold">
                  {isSpotlight
                    ? "Air · Public"
                    : audienceSummaryLabel(
                        audience,
                        muddies.filter((muddy) => selectedMuddies.includes(muddy.id)).map((muddy) => muddy.name)
                      )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="shrink-0 text-xs text-muted-foreground">Expires in</dt>
                <dd className="text-sm font-semibold">{preset?.label}</dd>
              </div>
            </dl>

            {isSpotlight ? (
              <label className="flex items-start gap-2.5 rounded-[1rem] bg-secondary/50 p-3">
                <input
                  type="checkbox"
                  checked={spotlightConfirmed}
                  onChange={(event) => setSpotlightConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="text-xs leading-5 text-muted-foreground">
                  I understand anyone on Mad Buddy can see this Moment until it expires.
                </span>
              </label>
            ) : (
              <p className="flex items-start gap-2 rounded-[1rem] bg-secondary/50 p-3 text-xs leading-5 text-muted-foreground">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Only the Muddies you chose can see this, and it disappears when it expires.
              </p>
            )}

            <button
              type="button"
              onClick={() => setStep("details")}
              className="focus-ring safe-motion inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Explains WHY Spotlight is worth upgrading for, rather than just saying
 * "Premium" and dropping the user on a plan page.
 *
 * The price comes from `spotlightUpgradeCopy()`, which reads the canonical
 * display prices and the entitlement registry to work out which plan actually
 * grants publishing and what the cheapest one costs. No price string, plan name
 * or benefit is written here, so this component cannot drift from billing.
 */
function SpotlightUpgradeNote() {
  const copy = spotlightUpgradeCopy();
  return (
    <div className="mt-2 rounded-xl border border-orange-400/25 bg-orange-400/10 p-3.5">
      <p className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-orange-700 dark:text-orange-200">
        <TuneInIcon className="h-3.5 w-3.5 shrink-0" />
        Go On Air
      </p>
      <p className="mt-1.5 text-sm font-semibold">Share your Moment beyond your Muddies.</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.body}</p>

      {copy.benefits.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {copy.benefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-1.5 text-xs">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
              <span className="min-w-0">{benefit}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Link
        href="/upgrade"
        prefetch={false}
        className="focus-ring safe-motion mt-3 inline-flex min-h-10 items-center rounded-full bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
      >
        {copy.cta}
      </Link>
      {copy.priceNote ? <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{copy.priceNote}</p> : null}
    </div>
  );
}
