"use client";

import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useState, useTransition } from "react";

import {
  addProfilePhotoAction,
  deleteProfilePhotoAction,
  reorderProfilePhotoAction,
  setProfilePhotoVisibilityAction
} from "@/app/(app)/profile-photo-actions";
import {
  MAX_PROFILE_PHOTOS,
  PHOTO_VISIBILITY_OPTIONS,
  canAddPhoto,
  type PhotoVisibility,
  type ProfilePhoto
} from "@/lib/profile/profile-photos";
import { cn } from "@/lib/utils";

/**
 * The profile photo carousel.
 *
 * One component for both jobs, because the owner needs to see exactly what a
 * visitor sees while managing it. A separate "edit gallery" screen would let
 * the two drift, and the question a person actually asks — "who can see
 * this one?" — is answered on the photo itself rather than in a settings list.
 *
 * The gallery NEVER includes the avatar. That stays the identity used across
 * the product; these are extra photos beside it.
 *
 * Visitors get a plain swipeable strip. Only the owner sees the per-photo
 * visibility control and the delete button, and only the owner is ever handed
 * `only_me` photos by the server.
 */

export function ProfilePhotoCarousel({
  photos,
  isOwner,
  onChanged,
  presentation = "carousel"
}: {
  /** Already filtered by the server for this viewer. */
  photos: readonly ProfilePhoto[];
  isOwner: boolean;
  /** Called after any mutation, so the page can refetch. */
  onChanged?: () => void;
  /** Compact three-up presentation used by the owner's reference-aligned page. */
  presentation?: "carousel" | "showcase";
}) {
  const [index, setIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const count = photos.length;
  // Clamped during render: deleting the last photo would otherwise leave the
  // index past the end and blank the viewer.
  const active = count === 0 ? 0 : Math.min(index, count - 1);

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((current) => (current + delta + count) % count);
    },
    [count]
  );

  function upload(file: File) {
    setUploading(true);
    setFeedback("");
    startTransition(async () => {
      const { compressImageForUpload } = await import("@/lib/media/client-compress");
      // Downscaled first: a phone photo is routinely several megabytes and
      // would bounce off the request cap before the server could read it.
      const compressed = await compressImageForUpload(file).catch(() => null);
      const prepared = compressed?.ok ? compressed.file : file;

      const form = new FormData();
      form.append("media", prepared);
      const result = await addProfilePhotoAction(form);
      setUploading(false);
      setFeedback(result.message);
      if (result.ok) onChanged?.();
    });
  }

  function setVisibility(photoId: string, visibility: PhotoVisibility) {
    startTransition(async () => {
      const result = await setProfilePhotoVisibilityAction({ photoId, visibility });
      setFeedback(result.message);
      if (result.ok) onChanged?.();
    });
  }

  /**
   * Move a photo one slot.
   *
   * Buttons rather than drag as the PRIMARY control: drag is unreachable by
   * keyboard, awkward on a three-item strip, and would need a dependency for
   * something two arrows do exactly. The photo keeps its id, its media and
   * its visibility — only the slot changes, and nothing is re-uploaded.
   */
  function move(photo: ProfilePhoto, delta: number) {
    const target = photo.position + delta;
    if (target < 0 || target >= MAX_PROFILE_PHOTOS) return;
    startTransition(async () => {
      const result = await reorderProfilePhotoAction({ photoId: photo.id, newPosition: target });
      setFeedback(result.message);
      if (result.ok) {
        // Follow the photo, so the viewer stays on the picture they moved
        // rather than on whatever slid into its old place.
        setIndex(target);
        onChanged?.();
      }
    });
  }

  function remove(photoId: string) {
    startTransition(async () => {
      const result = await deleteProfilePhotoAction({ photoId });
      setFeedback(result.message);
      if (result.ok) onChanged?.();
    });
  }

  // A visitor looking at someone with no visible photos sees nothing at all,
  // rather than an empty frame implying something was hidden from them.
  if (count === 0 && !isOwner) return null;

  const current = photos[active];

  if (presentation === "showcase" && count > 0) {
    const viewedPhoto = viewerIndex === null ? null : photos[viewerIndex];
    return (
      <section aria-labelledby="profile-showcase-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="profile-showcase-heading" className="text-sm font-semibold">My Showcase</h2>
          <p className="text-xs tabular-nums text-muted-foreground">{count} of {MAX_PROFILE_PHOTOS}</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {photos.map((photo, photoIndex) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewerIndex(photoIndex)}
              className="focus-ring safe-motion group relative aspect-[4/5] overflow-hidden rounded-2xl border border-border/60 bg-secondary/40 shadow-sm"
              aria-label={`Open showcase photo ${photoIndex + 1} of ${count}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed profile media URL */}
              <img src={photo.url} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
              {photoIndex === count - 1 && count > 1 ? (
                <span className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm" aria-hidden="true">
                  <ChevronRight className="h-4 w-4" />
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {viewedPhoto ? (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label={`Showcase photo ${viewerIndex! + 1} of ${count}`}>
            <button type="button" onClick={() => setViewerIndex(null)} className="focus-ring absolute right-4 top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white" aria-label="Close photo viewer">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed profile media URL */}
            <img src={viewedPhoto.url} alt={`Showcase photo ${viewerIndex! + 1}`} className="max-h-[82svh] max-w-full rounded-2xl object-contain" />
            {count > 1 ? (
              <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between">
                <button type="button" onClick={() => setViewerIndex((viewerIndex! - 1 + count) % count)} className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white" aria-label="Previous showcase photo"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={() => setViewerIndex((viewerIndex! + 1) % count)} className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white" aria-label="Next showcase photo"><ChevronRight className="h-5 w-5" /></button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="profile-photos-heading" className="profile-photos">
      <div className="profile-photos-head">
        <h2 id="profile-photos-heading" className="profile-photos-title">
          Photos
        </h2>
        {isOwner ? (
          <p className="profile-photos-count">
            {count} of {MAX_PROFILE_PHOTOS}
          </p>
        ) : null}
      </div>

      {current ? (
        <div className="profile-photos-frame">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset */}
          <img
            src={current.url}
            alt={isOwner ? `Your photo ${active + 1}` : `Photo ${active + 1} of ${count}`}
            className="profile-photos-image"
          />

          {/* Arrows only when there is somewhere to go. */}
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous photo"
                className="profile-photos-nav profile-photos-nav-prev"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next photo"
                className="profile-photos-nav profile-photos-nav-next"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>

              {/* Position, announced politely so a screen reader is told where
                  it is without interrupting whatever else is being read. */}
              <p className="profile-photos-dots" aria-live="polite">
                <span className="sr-only">
                  Photo {active + 1} of {count}
                </span>
                {photos.map((photo, dotIndex) => (
                  <span
                    key={photo.id}
                    aria-hidden="true"
                    className={cn("profile-photos-dot", dotIndex === active && "profile-photos-dot-on")}
                  />
                ))}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {/* OWNER CONTROLS. Visibility belongs on the photo it governs — asking
          "who can see this one?" anywhere else makes the answer harder to
          check than to change. */}
      {isOwner && current ? (
        <div className="profile-photos-controls">
          <div
            className="profile-photos-visibility"
            role="group"
            aria-label={`Who can see photo ${active + 1}`}
          >
            {PHOTO_VISIBILITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={current.visibility === option.id}
                title={option.hint}
                onClick={() => setVisibility(current.id, option.id)}
                disabled={isPending}
                className={cn(
                  "profile-photos-chip",
                  current.visibility === option.id && "profile-photos-chip-on"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Reorder, only when there is something to reorder against. */}
          {count > 1 ? (
            <div className="profile-photos-move" role="group" aria-label="Reorder photos">
              <button
                type="button"
                onClick={() => move(current, -1)}
                disabled={isPending || current.position === 0}
                aria-label={`Move photo ${active + 1} earlier`}
                className="profile-photos-move-button"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(current, 1)}
                disabled={isPending || current.position >= count - 1}
                aria-label={`Move photo ${active + 1} later`}
                className="profile-photos-move-button"
              >
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => remove(current.id)}
            disabled={isPending}
            aria-label={`Remove photo ${active + 1}`}
            className="profile-photos-remove"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {isOwner && canAddPhoto(photos) ? (
        <label className="profile-photos-add focus-ring">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
          )}
          {count === 0 ? "Add a photo" : "Add another"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading || isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice still fires.
              event.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>
      ) : null}

      {feedback ? <p className="profile-photos-feedback">{feedback}</p> : null}
    </section>
  );
}
