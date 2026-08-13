"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { uploadEventCoverAction, setEventCoverFocalAction } from "@/app/(app)/event-cover-actions";
import { COVER_GUIDANCE, clampFocal, focalObjectPosition } from "@/lib/events/cover";
import { compressImageForUpload } from "@/lib/media/client-compress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Event cover: pick, position, preview (Stage F UI, Part A).
 *
 * REUSES the canonical pieces rather than adding new ones: the same hidden
 * <input type="file"> + <label> pattern the profile carousel uses, the same
 * client compressor every other upload runs before hitting a Server Action,
 * and the already-built uploadEventCoverAction behind it. No second uploader,
 * no second cropper.
 *
 * WHY NOT THE MAD CAM EDITOR. components/camera/image-editor.tsx is a full
 * editor -- looks, effects, text, draw -- and it produces a DESTRUCTIVE crop.
 * A cover needs the opposite: the original kept intact, with two numbers
 * saying where the subject is, so one upload can be cropped differently by the
 * accordion, the list and the detail header. That is a focal point, not a
 * crop, so this is a small positioner rather than a reuse of that editor.
 */

/** The accordion panel is the tightest crop a cover has to survive. */
const PREVIEW_ASPECT = "4 / 5";

export type EventCoverValue = {
  /** Signed URL of the current cover, or null when there is none yet. */
  url: string | null;
  focalX: number;
  focalY: number;
};

export function EventCoverField({
  eventId,
  value,
  onChange,
  invalid = false,
  disabled = false,
  onPendingFile
}: {
  /** Null while the event does not exist yet (create flow, pre-save). */
  eventId: string | null;
  value: EventCoverValue;
  onChange: (next: EventCoverValue) => void;
  /** True after a publish attempt failed for a missing cover (§7). */
  invalid?: boolean;
  disabled?: boolean;
  /**
   * Receives a chosen file while no event exists yet.
   *
   * Present only in the create flow. The caller holds it until a provisional
   * draft exists, then uploads it through the canonical pipeline.
   */
  onPendingFile?: (file: File) => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // The committed focal point, so a drag that is abandoned can be reverted and
  // a successful one is only persisted once the gesture ends.
  const committedRef = useRef({ x: value.focalX, y: value.focalY });
  // Object URLs for locally-previewed uploads, revoked on unmount so a long
  // editing session does not leak a blob per replacement.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    committedRef.current = { x: value.focalX, y: value.focalY };
  }, [value.focalX, value.focalY]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      // NO EVENT YET: hold the file and show it immediately.
      //
      // The upload pipeline needs an event id to attach the asset to, but
      // that is an implementation detail and used to surface as "Save the
      // Event first, then add a cover" -- which made the cover unreachable
      // from the create form and turned one action into two round trips.
      //
      // The chosen file is kept locally and previewed; the caller uploads it
      // through the same canonical pipeline the moment a provisional draft
      // exists, so the person experiences one continuous Publish.
      if (!eventId) {
        if (onPendingFile) {
          const compressed = await compressImageForUpload(file);
          if (!compressed.ok) {
            setError(compressed.reason);
            return;
          }
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          const preview = URL.createObjectURL(compressed.file);
          objectUrlRef.current = preview;
          setError("");
          onPendingFile(compressed.file);
          onChange({ url: preview, focalX: value.focalX, focalY: value.focalY });
        }
        return;
      }
      // Duplicate-tap protection (§6): one upload in flight at a time.
      if (busy) return;
      setBusy(true);
      setError("");

      // Same client-side downscale every other upload uses, so a 12 MB phone
      // photo becomes something a Server Action will accept.
      const compressed = await compressImageForUpload(file);
      if (!compressed.ok) {
        setBusy(false);
        setError(compressed.reason);
        return;
      }

      const formData = new FormData();
      formData.append("eventId", eventId);
      formData.append("media", compressed.file);
      const result = await uploadEventCoverAction(formData);
      setBusy(false);

      if (!result.ok) {
        // The existing artwork is untouched on failure -- the server only
        // moves the pointer after the new asset is ready (§6). Nothing is
        // swapped in here until the server has confirmed, so a failed
        // replacement leaves the old cover on screen and in the database.
        setError(result.message);
        return;
      }
      setError("");
      // Only now, after the server confirmed: show the newly chosen image and
      // reset the focal point for it. The object URL is revoked on unmount.
      const previewUrl = URL.createObjectURL(compressed.file);
      objectUrlRef.current = previewUrl;
      onChange({ url: previewUrl, focalX: 0.5, focalY: 0.5 });
    },
    [busy, eventId, onChange, onPendingFile, value.focalX, value.focalY]
  );

  const moveFocal = useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      onChange({
        url: value.url,
        focalX: clampFocal((clientX - rect.left) / rect.width),
        focalY: clampFocal((clientY - rect.top) / rect.height)
      });
    },
    [onChange, value.url]
  );

  const persistFocal = useCallback(async () => {
    if (!eventId) return;
    const result = await setEventCoverFocalAction({
      eventId,
      focalX: value.focalX,
      focalY: value.focalY
    });
    if (!result.ok) setError(result.message);
  }, [eventId, value.focalX, value.focalY]);

  const hasCover = Boolean(value.url);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Event cover</span>
        {hasCover ? (
          <span className="text-xs text-muted-foreground">Drag to position</span>
        ) : null}
      </div>

      <div
        ref={frameRef}
        // Pointer events, not mouse: this must work under a finger (§24).
        // touch-action:none stops the page scrolling while positioning.
        onPointerDown={(pointerEvent) => {
          if (!hasCover || disabled) return;
          draggingRef.current = true;
          pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
          moveFocal(pointerEvent.clientX, pointerEvent.clientY);
        }}
        onPointerMove={(pointerEvent) => {
          if (!draggingRef.current) return;
          moveFocal(pointerEvent.clientX, pointerEvent.clientY);
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          void persistFocal();
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        style={{ aspectRatio: PREVIEW_ASPECT, touchAction: hasCover ? "none" : undefined }}
        className={cn(
          "relative w-full max-w-[13rem] overflow-hidden rounded-2xl border bg-muted",
          invalid ? "border-destructive ring-2 ring-destructive/30" : "border-border/70",
          hasCover && !disabled && "cursor-grab active:cursor-grabbing"
        )}
      >
        {value.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={value.url}
            alt=""
            draggable={false}
            style={{ objectPosition: focalObjectPosition(value.focalX, value.focalY) }}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs font-medium text-muted-foreground">No cover yet</span>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <Loader2 className="h-5 w-5 animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">Uploading cover image</span>
          </div>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Use a portrait image. Keep important faces and text near the centre so it works across Event
        cards. {COVER_GUIDANCE.aspectRatioLabel} works best (about {COVER_GUIDANCE.suggestedWidth}
        {" x "}
        {COVER_GUIDANCE.suggestedHeight}).
      </p>
      {hasCover ? (
        <p className="text-xs text-muted-foreground">This is how your Event may appear in discovery.</p>
      ) : null}

      <Button asChild type="button" size="sm" variant="outline" disabled={disabled || busy}>
        <label htmlFor={inputId} className={cn(disabled || busy ? "pointer-events-none opacity-60" : "cursor-pointer")}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
          )}
          {hasCover ? "Change cover" : "Add event cover"}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(changeEvent) => {
              const file = changeEvent.target.files?.[0];
              // Cleared so choosing the same file twice still fires.
              changeEvent.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </Button>

      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
