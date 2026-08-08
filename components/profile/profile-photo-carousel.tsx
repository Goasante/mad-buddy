"use client";

import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useCallback, useState, useTransition } from "react";

import {
  addProfilePhotoAction,
  deleteProfilePhotoAction,
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
  onChanged
}: {
  /** Already filtered by the server for this viewer. */
  photos: readonly ProfilePhoto[];
  isOwner: boolean;
  /** Called after any mutation, so the page can refetch. */
  onChanged?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

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
