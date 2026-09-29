"use client";

import { Check, ImagePlus, LockKeyhole, Users, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  createStoryAction,
  getStoryCreationContextAction
} from "@/app/(app)/stories-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { compressImageForUpload, MAX_SOURCE_IMAGE_BYTES } from "@/lib/media/client-compress";
import { validateImageSelection, validateImageSource } from "@/lib/media/validation";
import {
  STORY_ACTIVE_LIMIT,
  STORY_CAPTION_MAX_LENGTH,
  storySlotsRemaining,
  type StoryAudienceType,
  type StoryCreationContext
} from "@/lib/stories/types";
import { cn } from "@/lib/utils";

const EMPTY_CONTEXT: StoryCreationContext = { muddies: [], closeFriendsAvailable: false };

export function StoryComposer({
  open,
  activeCount,
  onOpenChange,
  onPublished
}: {
  open: boolean;
  activeCount: number;
  onOpenChange: (open: boolean) => void;
  onPublished: (message: string) => void;
}) {
  const [context, setContext] = useState<StoryCreationContext>(EMPTY_CONTEXT);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<StoryAudienceType>("all_muddies");
  const [selectedMuddies, setSelectedMuddies] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isPreparing, startPreparing] = useTransition();
  const [isPublishing, startPublishing] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const remaining = storySlotsRemaining(activeCount);
  const full = remaining === 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getStoryCreationContextAction().then((next) => {
      if (!cancelled) setContext(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setPreviewFailed(false);
    setCaption("");
    setAudience("all_muddies");
    setSelectedMuddies([]);
    setError("");
    setContext(EMPTY_CONTEXT);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  function choosePhoto(source: File) {
    if (full) {
      setError("You already have 5 active Stories. A new slot opens when your oldest Story expires.");
      return;
    }

    const extension = source.name.split(".").pop()?.toLowerCase();
    const isHeic =
      source.type === "image/heic" ||
      source.type === "image/heif" ||
      source.type === "image/heic-sequence" ||
      source.type === "image/heif-sequence" ||
      source.type === "image/x-heic" ||
      source.type === "image/x-heif" ||
      extension === "heic" ||
      extension === "heif";
    const isAvif = source.type === "image/avif" || extension === "avif";

    const sourceError = isAvif
      ? source.size <= 0
        ? "Choose an image first."
        : source.size > MAX_SOURCE_IMAGE_BYTES
          ? "That image is unusually large. Choose another one."
          : null
      : validateImageSource(
          source,
          isHeic ? "profile" : "moment",
          MAX_SOURCE_IMAGE_BYTES
        );
    if (sourceError) {
      setError(sourceError);
      return;
    }

    startPreparing(async () => {
      // Modern phone formats are converted automatically in the browser when
      // possible. HEIC/HEIF still has a server-side fallback for browsers that
      // can select the file but cannot decode it locally.
      const compressed = await compressImageForUpload(source, {
        forceReencode: isHeic || isAvif
      });
      if (!compressed.ok) {
        if (isHeic) {
          const uploadError = validateImageSelection(source, "profile");
          if (!uploadError) {
            if (preview) URL.revokeObjectURL(preview);
            setFile(source);
            setPreviewFailed(false);
            setPreview(URL.createObjectURL(source));
            setError("");
            return;
          }
        }
        setError(compressed.reason);
        return;
      }
      const uploadError = validateImageSelection(compressed.file, "moment");
      if (uploadError) {
        setError(uploadError);
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      setFile(compressed.file);
      setPreviewFailed(false);
      setPreview(URL.createObjectURL(compressed.file));
      setError("");
    });
  }

  function publish() {
    if (!file || full || isPublishing) return;
    if (audience === "selected_muddies" && selectedMuddies.length === 0) {
      setError("Choose at least one Muddy.");
      return;
    }

    const formData = new FormData();
    formData.set("media", file);
    formData.set("caption", caption.trim());
    formData.set("audienceType", audience);
    if (audience === "selected_muddies") {
      selectedMuddies.forEach((id) => formData.append("targetId", id));
    }

    startPublishing(async () => {
      const result = await createStoryAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onPublished(result.message);
      close();
    });
  }

  const audienceOptions: Array<{
    id: StoryAudienceType;
    label: string;
    hint: string;
    icon: typeof Users;
  }> = [
    { id: "all_muddies", label: "All Muddies", hint: "Every approved Muddy", icon: Users },
    ...(context.closeFriendsAvailable
      ? [{ id: "close_friends" as const, label: "Close Friends", hint: "Only your Close Friends", icon: LockKeyhole }]
      : []),
    { id: "selected_muddies", label: "Selected Muddies", hint: "Choose specific people", icon: Users }
  ];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Add Story"
      description="Photo Stories disappear 12 hours after you share them."
      variant="sheet"
      compact
      footer={
        file ? (
          <Button type="button" className="w-full" disabled={isPublishing || full} onClick={publish}>
            {isPublishing ? "Sharing…" : "Share Story"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-secondary/45 px-3 py-2 text-xs">
          <span className="font-medium">{activeCount} of {STORY_ACTIVE_LIMIT} Stories active</span>
          <span className="text-muted-foreground">{remaining} {remaining === 1 ? "slot" : "slots"} open</span>
        </div>

        {full ? (
          <p role="status" className="rounded-xl border border-border bg-secondary/35 p-3 text-sm text-muted-foreground">
            A new Story slot opens as soon as your oldest active Story reaches 12 hours.
          </p>
        ) : null}

        {!file ? (
          <div className="space-y-2.5">
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.avif,.heic,.heif"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) choosePhoto(picked);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={libraryRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.avif,.heic,.heif"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) choosePhoto(picked);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={full || isPreparing}
              onClick={() => cameraRef.current?.click()}
              className="focus-ring safe-motion flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 text-left hover:bg-secondary disabled:opacity-50"
            >
              <ImagePlus className="h-5 w-5 text-[#E88C2B]" aria-hidden="true" />
              <span className="text-sm font-semibold">Take a photo</span>
            </button>
            <button
              type="button"
              disabled={full || isPreparing}
              onClick={() => libraryRef.current?.click()}
              className="focus-ring safe-motion flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 text-left hover:bg-secondary disabled:opacity-50"
            >
              <ImagePlus className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">Choose from library</span>
            </button>
            {isPreparing ? <p className="text-xs text-muted-foreground">Preparing your photo…</p> : null}
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-2xl bg-black">
              {previewFailed ? (
                <div className="grid aspect-[4/5] w-full place-items-center px-6 text-center text-white">
                  <div>
                    <ImagePlus className="mx-auto h-8 w-8 text-white/70" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold">Photo ready to share</p>
                    <p className="mt-1 text-xs text-white/65">
                      This browser cannot preview the original phone format, but Mad Buddy can still prepare it when you share.
                    </p>
                  </div>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
                <img
                  src={preview ?? ""}
                  alt="Story preview"
                  className="aspect-[4/5] w-full object-contain"
                  onError={() => setPreviewFailed(true)}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  if (preview) URL.revokeObjectURL(preview);
                  setFile(null);
                  setPreview(null);
                  setPreviewFailed(false);
                }}
                className="focus-ring absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white"
                aria-label="Choose a different photo"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div>
              <Textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value.slice(0, STORY_CAPTION_MAX_LENGTH))}
                placeholder="Add a caption (optional)"
                rows={3}
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {caption.length}/{STORY_CAPTION_MAX_LENGTH}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who can see it</p>
              {audienceOptions.map((option) => {
                const Icon = option.icon;
                const selected = audience === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setAudience(option.id);
                      setError("");
                    }}
                    className={cn(
                      "focus-ring safe-motion flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left",
                      selected ? "border-primary/60 bg-primary/8" : "border-border bg-card/60 hover:bg-secondary"
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                    {selected ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>

            {audience === "selected_muddies" ? (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                {context.muddies.length ? (
                  context.muddies.map((muddy) => {
                    const selected = selectedMuddies.includes(muddy.id);
                    return (
                      <button
                        key={muddy.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setSelectedMuddies((current) =>
                            selected ? current.filter((id) => id !== muddy.id) : [...current, muddy.id]
                          )
                        }
                        className="focus-ring flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-secondary"
                      >
                        <UserAvatar src={muddy.avatarUrl} name={muddy.name} size="sm" decorative />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{muddy.name}</span>
                        <span
                          className={cn(
                            "grid h-5 w-5 place-items-center rounded-full border",
                            selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          )}
                        >
                          {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">No Muddies are available for this audience.</p>
                )}
              </div>
            ) : null}
          </>
        )}

        {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}
