"use client";

import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2 } from "lucide-react";
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
  batchOutcomeMessage,
  canAddPhoto,
  remainingPhotoSlots,
  selectPhotoBatch,
  type BatchItemStatus,
  type PhotoVisibility,
  type ProfilePhoto
} from "@/lib/profile/profile-photos";
import { Button } from "@/components/ui/button";
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
  /**
   * The chosen-but-not-yet-uploaded tray.
   *
   * Exists so a batch is one interaction: pick up to the remaining slots, see
   * what you picked, then upload. Going through the phone picker once per
   * photo was the reported complaint.
   */
  const [queue, setQueue] = useState<{ file: File; url: string; status: BatchItemStatus }[]>([]);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const count = photos.length;
  // Clamped during render: deleting the last photo would otherwise leave the
  // index past the end and blank the viewer.
  const active = count === 0 ? 0 : Math.min(index, count - 1);
  // How many more will fit, so the control can say it before the picker opens.
  const remaining = remainingPhotoSlots(photos);

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((current) => (current + delta + count) % count);
    },
    [count]
  );

  /**
   * Upload one file. Returns whether it landed, so the batch can count.
   *
   * NOT inside startTransition. A transition is interruptible by design and
   * React really does abandon the work it wraps -- for a read that is merely
   * wasteful, but for an upload it means the request is killed mid-flight and
   * the person cannot tell whether their photo was saved. Uploads run as plain
   * async work with their own pending flag.
   */
  const uploadOne = useCallback(async (file: File): Promise<boolean> => {
    const { compressImageForUpload } = await import("@/lib/media/client-compress");
    // Downscaled first: a phone photo is routinely several megabytes and
    // would bounce off the request cap before the server could read it.
    const compressed = await compressImageForUpload(file).catch(() => null);
    const prepared = compressed?.ok ? compressed.file : file;

    const form = new FormData();
    form.append("media", prepared);
    const result = await addProfilePhotoAction(form);
    if (!result.ok) setFeedback(result.message);
    return result.ok;
  }, []);

  /**
   * Upload a whole selection, one request at a time.
   *
   * SEQUENTIAL on purpose: three phone photos in parallel is three large
   * multipart bodies competing on a mobile uplink, and the server processes
   * them individually anyway. What matters to the person is that the batch is
   * one action with one outcome.
   *
   * A FAILURE DOES NOT DISCARD THE SUCCESSES. Each file's result is recorded
   * on its own, the ones that landed stay landed, and the ones that did not
   * remain in the tray so they can be retried without re-picking everything.
   */
  const uploadBatch = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setFeedback("");
      let succeeded = 0;
      let failed = 0;

      for (const file of files) {
        setQueue((current) =>
          current.map((item) => (item.file === file ? { ...item, status: "uploading" } : item))
        );
        // Never let one rejected file abandon the rest of the batch.
        const ok = await uploadOne(file).catch(() => false);
        if (ok) succeeded += 1;
        else failed += 1;
        setQueue((current) =>
          current.map((item) =>
            item.file === file ? { ...item, status: ok ? "done" : "failed" } : item
          )
        );
      }

      setUploading(false);
      setFeedback(batchOutcomeMessage(succeeded, failed));
      // Keep only what still needs attention; the rest has served its purpose.
      setQueue((current) => current.filter((item) => item.status === "failed"));
      if (succeeded > 0) onChanged?.();
    },
    [onChanged, uploadOne]
  );

  /** Turn a picker selection into a tray, saying so when it did not all fit. */
  const chooseFiles = useCallback(
    (chosen: FileList | null) => {
      if (!chosen || chosen.length === 0) return;
      const decision = selectPhotoBatch(Array.from(chosen), photos);
      setFeedback(decision.message ?? "");
      if (decision.accepted.length === 0) return;
      setQueue(
        decision.accepted.map((file) => ({
          file,
          url: URL.createObjectURL(file),
          status: "pending" as BatchItemStatus
        }))
      );
    },
    [photos]
  );

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
          {count === 0 ? "Add photos" : `Add ${remaining} more`}
          {/* MULTIPLE, so one trip through the phone picker can fill every
              remaining slot. Selecting one photo at a time -- three separate
              journeys into the camera roll to fill three slots -- was the
              reported complaint. Over-selection is reported rather than
              silently trimmed; see selectPhotoBatch. */}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={uploading || isPending}
            onChange={(event) => {
              const chosen = event.target.files;
              // Cleared so choosing the same files twice still fires.
              const files = chosen ? Array.from(chosen) : [];
              event.target.value = "";
              if (files.length > 0) {
                const list = new DataTransfer();
                files.forEach((file) => list.items.add(file));
                chooseFiles(list.files);
              }
            }}
          />
        </label>
      ) : null}

      {/* THE TRAY. What was picked, before it is sent -- so the batch is one
          reviewable action rather than a series of surprises. */}
      {queue.length > 0 ? (
        <div className="profile-photos-tray">
          <ul className="profile-photos-tray-list">
            {queue.map((item) => (
              <li key={item.url} className="profile-photos-tray-item" data-status={item.status}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt="" className="profile-photos-tray-thumb" />
                {item.status === "uploading" ? (
                  <span className="profile-photos-tray-badge">
                    <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  </span>
                ) : item.status === "failed" ? (
                  <span className="profile-photos-tray-badge" data-failed="true">
                    !
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="profile-photos-tray-actions">
            <Button
              type="button"
              size="sm"
              disabled={uploading}
              onClick={() => void uploadBatch(queue.map((item) => item.file))}
            >
              {uploading
                ? "Adding…"
                : queue.some((item) => item.status === "failed")
                  ? "Retry"
                  : `Add ${queue.length === 1 ? "photo" : `${queue.length} photos`}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                // Release the object URLs rather than leaking them.
                queue.forEach((item) => URL.revokeObjectURL(item.url));
                setQueue([]);
                setFeedback("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {feedback ? <p className="profile-photos-feedback">{feedback}</p> : null}
    </section>
  );
}
