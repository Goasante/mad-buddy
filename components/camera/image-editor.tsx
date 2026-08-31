"use client";

import {
  Check,
  Crop,
  FlipHorizontal2,
  Loader2,
  Pencil,
  Redo2,
  RotateCw,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  STRAIGHTEN_RANGE,
  clampNormalizedCrop,
  createImageEditDocument,
  createImageEditSession,
  cropForPreset,
  imageEditReducer,
  rotateClockwise,
  setAdjustment,
  type CropPreset,
  type ImageAdjustmentKey,
  type ImageDrawingStroke,
  type ImageEditDocument,
  type ImageTextOverlay,
  type NormalizedCrop,
  type NormalizedPoint
} from "@/lib/camera/image-edit-session";
import {
  decodeImageSource,
  exportEditedImage,
  renderEditedImage,
  type DecodedImageSource
} from "@/lib/camera/image-renderer";
import { detectEffectCapabilities, canRenderEffect, type EffectCapabilities } from "@/lib/camera/effect-capabilities";
import { resetDocumentEffects, setDocumentEffect, setDocumentEffectIntensity, type EffectInstance } from "@/lib/camera/effect-document";
import { effectInstanceFor, getMadEffect, MAD_EFFECTS } from "@/lib/camera/effect-registry";
import { EffectThumbnailCache, generateEffectThumbnails } from "@/lib/camera/effect-thumbnails";
import { generateLookThumbnails, LookThumbnailCache } from "@/lib/camera/look-thumbnails";
import {
  MAD_LOOKS,
  ORIGINAL_LOOK_ID,
  documentForOriginalComparison,
  getMadLook,
  resetDocumentLook,
  setDocumentLook,
  setDocumentLookIntensity
} from "@/lib/camera/mad-looks";
import type { LocalCameraImage } from "@/lib/camera/types";
import { cn } from "@/lib/utils";

type EditorTool = "looks" | "effects" | "crop" | "adjust" | "text" | "draw";
type CropDrag = {
  pointerId: number;
  mode: "move" | "nw" | "ne" | "sw" | "se";
  start: NormalizedPoint;
  crop: NormalizedCrop;
  before: ImageEditDocument;
};
type TextDrag = {
  pointerId: number;
  id: string;
  start: NormalizedPoint;
  position: NormalizedPoint;
  before: ImageEditDocument;
};

const CROP_PRESETS: Array<{ value: CropPreset; label: string }> = [
  { value: "free", label: "Free" },
  { value: "original", label: "Original" },
  { value: "square", label: "Square" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" }
];
const ADJUSTMENTS: Array<{ key: ImageAdjustmentKey; label: string }> = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "warmth", label: "Warmth" }
];
const COLORS = ["#FFFFFF", "#111827", "#FF7A12", "#38BDF8", "#34D399", "#F472B6"];

export default function ImageEditor({
  source,
  initialEffect,
  onCancel,
  onDone
}: {
  source: LocalCameraImage;
  initialEffect?: EffectInstance | null;
  onCancel: () => void;
  onDone: (media: LocalCameraImage) => void;
}) {
  const [session, dispatch] = useReducer(
    imageEditReducer,
    { source, initialEffect },
    ({ source: initialSource, initialEffect: seededEffect }) => {
      const initialDocument = seededEffect
        ? setDocumentEffect(createImageEditDocument(), seededEffect)
        : createImageEditDocument();
      return createImageEditSession(initialSource, initialDocument);
    }
  );
  const [tool, setTool] = useState<EditorTool>("looks");
  const [previewSize, setPreviewSize] = useState({ width: source.width, height: source.height });
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(0.012);
  const [draftStroke, setDraftStroke] = useState<NormalizedPoint[]>([]);
  const [lookThumbnails, setLookThumbnails] = useState<{ sourceKey: string; urls: Record<string, string> }>({
    sourceKey: source.objectUrl,
    urls: {}
  });
  const [effectThumbnails, setEffectThumbnails] = useState<{ sourceKey: string; urls: Record<string, string> }>({
    sourceKey: source.objectUrl,
    urls: {}
  });
  const [effectCapabilities, setEffectCapabilities] = useState<EffectCapabilities | null>(null);
  const [effectFrame, setEffectFrame] = useState(0);
  const [decodedReady, setDecodedReady] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const decodedRef = useRef<DecodedImageSource | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const thumbnailCacheRef = useRef<LookThumbnailCache | null>(null);
  const effectThumbnailCacheRef = useRef<EffectThumbnailCache | null>(null);
  const transientBeforeRef = useRef<ImageEditDocument | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const textDragRef = useRef<TextDrag | null>(null);
  const drawPointerRef = useRef<number | null>(null);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEffectCapabilities(detectEffectCapabilities()));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const bounds = stage.getBoundingClientRect();
      setStageBounds({ width: Math.max(1, bounds.width - 24), height: Math.max(1, bounds.height - 24) });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void decodeImageSource(source.blob).then((decoded) => {
      if (cancelled) {
        decoded.close();
        return;
      }
      decodedRef.current = decoded;
      setDecodedReady(true);
      dispatch({ type: "lifecycle", lifecycle: "ready" });
    }).catch(() => dispatch({ type: "lifecycle", lifecycle: "failed", error: "This photo could not be opened." }));
    return () => {
      cancelled = true;
      decodedRef.current?.close();
      decodedRef.current = null;
      if (workCanvasRef.current) {
        workCanvasRef.current.width = 0;
        workCanvasRef.current.height = 0;
      }
      workCanvasRef.current = null;
    };
  }, [source.blob]);

  useEffect(() => {
    if (!thumbnailCacheRef.current) thumbnailCacheRef.current = new LookThumbnailCache();
    return () => {
      thumbnailCacheRef.current?.clear();
      thumbnailCacheRef.current = null;
    };
  }, [source.objectUrl]);

  useEffect(() => {
    if (!effectThumbnailCacheRef.current) effectThumbnailCacheRef.current = new EffectThumbnailCache();
    return () => {
      effectThumbnailCacheRef.current?.clear();
      effectThumbnailCacheRef.current = null;
    };
  }, [source.objectUrl]);

  useEffect(() => {
    const decoded = decodedRef.current;
    const cache = thumbnailCacheRef.current;
    if (tool !== "looks" || !decodedReady || !decoded || !cache) return;
    let cancelled = false;
    void generateLookThumbnails({
      decoded,
      sourceKey: source.objectUrl,
      cache,
      isCancelled: () => cancelled,
      onThumbnail: (lookId, url) => {
        if (!cancelled) {
          setLookThumbnails((current) => current.sourceKey === source.objectUrl
            ? { ...current, urls: { ...current.urls, [lookId]: url } }
            : { sourceKey: source.objectUrl, urls: { [lookId]: url } });
        }
      }
    }).catch(() => {
      // A failed thumbnail never blocks the full-size canonical preview.
    });
    return () => {
      cancelled = true;
    };
  }, [decodedReady, source.objectUrl, tool]);

  useEffect(() => {
    const decoded = decodedRef.current;
    const cache = effectThumbnailCacheRef.current;
    if (tool !== "effects" || !decodedReady || !decoded || !cache) return;
    let cancelled = false;
    void generateEffectThumbnails({
      decoded,
      sourceKey: source.objectUrl,
      cache,
      isCancelled: () => cancelled,
      onThumbnail: (effectId, url) => {
        if (!cancelled) {
          setEffectThumbnails((current) => current.sourceKey === source.objectUrl
            ? { ...current, urls: { ...current.urls, [effectId]: url } }
            : { sourceKey: source.objectUrl, urls: { [effectId]: url } });
        }
      }
    }).catch(() => {
      // Thumbnail failure never blocks the canonical full-size effect preview.
    });
    return () => {
      cancelled = true;
    };
  }, [decodedReady, source.objectUrl, tool]);

  const activeEffectInstance = session.present.effects[0] ?? null;
  const activeEffect = activeEffectInstance ? getMadEffect(activeEffectInstance.effectId) : null;

  useEffect(() => {
    if (tool !== "effects" || !activeEffect?.animated || effectCapabilities?.reducedMotion) return;
    const timer = window.setInterval(() => setEffectFrame(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [activeEffect?.animated, effectCapabilities?.reducedMotion, tool]);

  useEffect(() => {
    const decoded = decodedRef.current;
    const canvas = canvasRef.current;
    if (!decoded || !canvas) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      dispatch({ type: "lifecycle", lifecycle: "rendering_preview" });
      try {
        const activeDocument = compareOriginal ? documentForOriginalComparison(session.present) : session.present;
        const previewDocument = tool === "crop" && !compareOriginal
          ? { ...activeDocument, geometry: { ...activeDocument.geometry, crop: { x: 0, y: 0, width: 1, height: 1 } } }
          : activeDocument;
        if (!workCanvasRef.current) workCanvasRef.current = globalThis.document.createElement("canvas");
        const dimensions = renderEditedImage(decoded, previewDocument, canvas, {
          includeOverlays: tool !== "text" && tool !== "draw",
          workCanvas: workCanvasRef.current,
          timeMs: effectFrame,
          reducedMotion: effectCapabilities?.reducedMotion ?? true
        });
        setPreviewSize(dimensions);
        dispatch({ type: "lifecycle", lifecycle: "ready" });
      } catch {
        dispatch({ type: "lifecycle", lifecycle: "failed", error: "The preview could not be rendered." });
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [compareOriginal, effectCapabilities?.reducedMotion, effectFrame, session.present, tool, session.source]);

  const replace = useCallback((document: ImageEditDocument, recordHistory = true) => {
    dispatch({ type: "replace", document, recordHistory });
  }, []);

  const beginTransient = useCallback(() => {
    if (!transientBeforeRef.current) transientBeforeRef.current = session.present;
  }, [session.present]);

  const commitTransient = useCallback(() => {
    const before = transientBeforeRef.current;
    transientBeforeRef.current = null;
    if (before) dispatch({ type: "commit_preview", before });
  }, []);

  async function finishEditing() {
    const decoded = decodedRef.current;
    if (!decoded || session.lifecycle === "exporting") return;
    dispatch({ type: "lifecycle", lifecycle: "exporting" });
    try {
      const media = await exportEditedImage(decoded, session.present, source);
      onDone(media);
    } catch {
      dispatch({ type: "lifecycle", lifecycle: "failed", error: "Your edit could not be prepared. Try again." });
    }
  }

  function applyCropPreset(preset: CropPreset) {
    const crop = cropForPreset(preset, source.width, source.height, session.present.geometry.rotation);
    replace({
      ...session.present,
      geometry: { ...session.present.geometry, cropPreset: preset, crop }
    });
  }

  function normalizedPointer(event: ReactPointerEvent<Element>): NormalizedPoint {
    const rect = frameRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  function startCropDrag(event: ReactPointerEvent<HTMLElement>, mode: CropDrag["mode"]) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      mode,
      start: normalizedPointer(event),
      crop: session.present.geometry.crop,
      before: session.present
    };
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalizedPointer(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    let next = { ...drag.crop };
    if (drag.mode === "move") next = { ...next, x: next.x + dx, y: next.y + dy };
    if (drag.mode.includes("n")) next = { ...next, y: next.y + dy, height: next.height - dy };
    if (drag.mode.includes("s")) next.height += dy;
    if (drag.mode.includes("w")) next = { ...next, x: next.x + dx, width: next.width - dx };
    if (drag.mode.includes("e")) next.width += dx;
    next = clampNormalizedCrop(next);
    replace({
      ...session.present,
      geometry: { ...session.present.geometry, cropPreset: "free", crop: next }
    }, false);
  }

  function endCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
    dispatch({ type: "commit_preview", before: drag.before });
  }

  function updateText(id: string, patch: Partial<ImageTextOverlay>, recordHistory = true) {
    replace({
      ...session.present,
      textOverlays: session.present.textOverlays.map((overlay) => overlay.id === id ? { ...overlay, ...patch } : overlay)
    }, recordHistory);
  }

  function addText() {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `text-${Date.now()}`;
    replace({
      ...session.present,
      textOverlays: [...session.present.textOverlays, {
        id,
        text: "Your text",
        position: { x: 0.5, y: 0.5 },
        size: 0.075,
        rotation: 0,
        color: COLORS[0],
        align: "center"
      }]
    });
    setSelectedTextId(id);
  }

  function startTextDrag(event: ReactPointerEvent<HTMLButtonElement>, overlay: ImageTextOverlay) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    textDragRef.current = {
      pointerId: event.pointerId,
      id: overlay.id,
      start: normalizedPointer(event),
      position: overlay.position,
      before: session.present
    };
    setSelectedTextId(overlay.id);
  }

  function moveText(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = textDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalizedPointer(event);
    updateText(drag.id, { position: {
      x: Math.min(0.95, Math.max(0.05, drag.position.x + point.x - drag.start.x)),
      y: Math.min(0.95, Math.max(0.05, drag.position.y + point.y - drag.start.y))
    } }, false);
  }

  function endTextDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = textDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    textDragRef.current = null;
    dispatch({ type: "commit_preview", before: drag.before });
  }

  function startDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool !== "draw") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawPointerRef.current = event.pointerId;
    setDraftStroke([normalizedPointer(event)]);
  }

  function continueDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (drawPointerRef.current !== event.pointerId) return;
    setDraftStroke((points) => [...points, normalizedPointer(event)].slice(-500));
  }

  function finishDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    if (drawPointerRef.current !== event.pointerId) return;
    drawPointerRef.current = null;
    if (draftStroke.length > 1) {
      const stroke: ImageDrawingStroke = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `stroke-${Date.now()}`,
        color: drawColor,
        size: brushSize,
        points: draftStroke
      };
      replace({ ...session.present, drawingStrokes: [...session.present.drawingStrokes, stroke] });
    }
    setDraftStroke([]);
  }

  const selectedText = useMemo(
    () => session.present.textOverlays.find((overlay) => overlay.id === selectedTextId) ?? null,
    [selectedTextId, session.present.textOverlays]
  );
  const activeLook = getMadLook(session.present.look.id);
  const activeLookThumbnails = lookThumbnails.sourceKey === source.objectUrl ? lookThumbnails.urls : {};
  const activeEffectThumbnails = effectThumbnails.sourceKey === source.objectUrl ? effectThumbnails.urls : {};
  const availableEffects = effectCapabilities
    ? MAD_EFFECTS.filter((effect) => canRenderEffect(effect, effectCapabilities))
    : MAD_EFFECTS;
  const aspect = `${previewSize.width} / ${previewSize.height}`;
  const frameDimensions = useMemo(() => {
    if (!stageBounds.width || !stageBounds.height) return null;
    const ratio = previewSize.width / previewSize.height;
    let width = stageBounds.width;
    let height = width / ratio;
    if (height > stageBounds.height) {
      height = stageBounds.height;
      width = height * ratio;
    }
    return { width, height };
  }, [previewSize.height, previewSize.width, stageBounds.height, stageBounds.width]);

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !rootRef.current) return;
    const focusable = [...rootRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div ref={rootRef} className="mad-cam-editor" role="dialog" aria-modal="true" aria-label="Photo editor" onKeyDown={handleEditorKeyDown}>
      <header className="mad-cam-editor-header">
        <button ref={closeRef} type="button" className="mad-cam-editor-icon" onClick={onCancel} aria-label="Close editor" title="Close editor">
          <X aria-hidden="true" />
        </button>
        <div className="flex items-center gap-1">
          <button type="button" className="mad-cam-editor-icon" disabled={!session.past.length} onClick={() => dispatch({ type: "undo" })} aria-label="Undo" title="Undo">
            <Undo2 aria-hidden="true" />
          </button>
          <button type="button" className="mad-cam-editor-icon" disabled={!session.future.length} onClick={() => dispatch({ type: "redo" })} aria-label="Redo" title="Redo">
            <Redo2 aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="mad-cam-editor-done" onClick={() => void finishEditing()} disabled={session.lifecycle === "loading" || session.lifecycle === "exporting"}>
          {session.lifecycle === "exporting" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Done
        </button>
      </header>

      <main ref={stageRef} className="mad-cam-editor-stage" aria-busy={session.lifecycle === "loading" || session.lifecycle === "exporting"}>
        <div
          ref={frameRef}
          className="mad-cam-editor-frame"
          style={{ "--mad-cam-editor-aspect": aspect, width: frameDimensions ? `${frameDimensions.width}px` : "100%", height: frameDimensions ? `${frameDimensions.height}px` : "auto" } as CSSProperties}
          onPointerDown={tool === "looks" || tool === "effects" ? () => setCompareOriginal(true) : undefined}
          onPointerUp={tool === "looks" || tool === "effects" ? () => setCompareOriginal(false) : undefined}
          onPointerCancel={tool === "looks" || tool === "effects" ? () => setCompareOriginal(false) : undefined}
          onPointerLeave={tool === "looks" || tool === "effects" ? () => setCompareOriginal(false) : undefined}
        >
          <canvas ref={canvasRef} className="h-full w-full" aria-label="Edited photo preview" />
          {tool === "crop" ? (
            <div className="absolute inset-0 touch-none" onPointerMove={moveCrop} onPointerUp={endCropDrag} onPointerCancel={endCropDrag}>
              <div
                className="mad-cam-crop-box"
                style={{
                  left: `${session.present.geometry.crop.x * 100}%`,
                  top: `${session.present.geometry.crop.y * 100}%`,
                  width: `${session.present.geometry.crop.width * 100}%`,
                  height: `${session.present.geometry.crop.height * 100}%`
                }}
                onPointerDown={(event) => startCropDrag(event, "move")}
                aria-label="Crop selection"
                role="group"
              >
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <span key={corner} className={`mad-cam-crop-handle is-${corner}`} onPointerDown={(event) => { event.stopPropagation(); startCropDrag(event, corner); }} aria-hidden="true" />
                ))}
              </div>
            </div>
          ) : null}
          {tool === "text" ? session.present.textOverlays.map((overlay) => (
            <button
              type="button"
              key={overlay.id}
              className={cn("mad-cam-text-overlay", selectedTextId === overlay.id && "is-selected")}
              style={{ left: `${overlay.position.x * 100}%`, top: `${overlay.position.y * 100}%`, color: overlay.color, fontSize: `${overlay.size * 100}cqi`, rotate: `${overlay.rotation}deg` }}
              onPointerDown={(event) => startTextDrag(event, overlay)}
              onPointerMove={moveText}
              onPointerUp={endTextDrag}
              onPointerCancel={endTextDrag}
            >
              {overlay.text}
            </button>
          )) : null}
          {tool === "draw" ? (
            <svg className="absolute inset-0 h-full w-full touch-none" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Drawing layer" onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing}>
              {[...session.present.drawingStrokes, ...(draftStroke.length > 1 ? [{ id: "draft", color: drawColor, size: brushSize, points: draftStroke }] : [])].map((stroke) => (
                <polyline key={stroke.id} points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.size} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          ) : null}
          {compareOriginal ? <span className="mad-cam-original-indicator" role="status">Original</span> : null}
        </div>
        {session.lifecycle === "loading" ? <Loader2 className="absolute h-7 w-7 animate-spin text-[#FF8A1F] motion-reduce:animate-none" aria-label="Loading editor" /> : null}
        {session.lifecycle === "failed" ? <p className="absolute rounded-xl bg-red-950/85 px-4 py-3 text-sm" role="alert">{session.error}</p> : null}
      </main>

      <section className="mad-cam-editor-panel" aria-label={`${tool} controls`}>
        {tool === "looks" ? (
          <div className="space-y-3">
            <div className="mad-cam-look-rail" role="group" aria-label="Mad Looks">
              {MAD_LOOKS.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  className={cn("mad-cam-look-option", activeLook.id === look.id && "is-selected")}
                  aria-label={`${look.name} Look`}
                  aria-pressed={activeLook.id === look.id}
                  onClick={() => replace(setDocumentLook(session.present, look.id))}
                >
                  <span className="mad-cam-look-thumbnail" style={{ "--mad-look-accent": look.presentation.accent } as CSSProperties}>
                    {activeLookThumbnails[look.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local low-resolution object URL
                      <img src={activeLookThumbnails[look.id]} alt="" aria-hidden="true" />
                    ) : <span className="mad-cam-look-placeholder" aria-hidden="true" />}
                  </span>
                  <span>{look.name}</span>
                </button>
              ))}
            </div>
            <div className="mad-cam-look-controls">
              <label className="mad-cam-editor-range min-w-0 flex-1">
                <span>{activeLook.name} intensity: {session.present.look.intensity}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={session.present.look.intensity}
                  disabled={activeLook.id === ORIGINAL_LOOK_ID}
                  onFocus={beginTransient}
                  onPointerDown={beginTransient}
                  onChange={(event) => replace(setDocumentLookIntensity(session.present, Number(event.target.value)), false)}
                  onBlur={commitTransient}
                  onPointerUp={commitTransient}
                  aria-label={`${activeLook.name} Look intensity`}
                  aria-valuetext={`${session.present.look.intensity} percent`}
                />
              </label>
              <button type="button" className="mad-cam-reset-control" disabled={activeLook.id === ORIGINAL_LOOK_ID} onClick={() => replace(resetDocumentLook(session.present))}>Reset Look</button>
              <button
                type="button"
                className="mad-cam-compare-control"
                onPointerDown={() => setCompareOriginal(true)}
                onPointerUp={() => setCompareOriginal(false)}
                onPointerCancel={() => setCompareOriginal(false)}
                onPointerLeave={() => setCompareOriginal(false)}
                onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") setCompareOriginal(true); }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") setCompareOriginal(false); }}
                aria-label="Hold to compare original"
              >
                Hold to compare
              </button>
            </div>
          </div>
        ) : null}
        {tool === "effects" ? (
          <div className="space-y-3">
            <div className="mad-cam-effect-rail" role="group" aria-label="Mad Effects">
              <button
                type="button"
                className={cn("mad-cam-effect-option", !activeEffect && "is-selected")}
                aria-label="No effect"
                aria-pressed={!activeEffect}
                onClick={() => replace(resetDocumentEffects(session.present))}
              >
                <span className="mad-cam-effect-thumbnail is-original">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local image object URL */}
                  <img src={source.objectUrl} alt="" aria-hidden="true" />
                </span>
                <span>None</span>
              </button>
              {availableEffects.map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  className={cn("mad-cam-effect-option", activeEffect?.id === effect.id && "is-selected")}
                  aria-label={`${effect.name} effect`}
                  aria-pressed={activeEffect?.id === effect.id}
                  onClick={() => {
                    const instance = effectInstanceFor(effect.id);
                    if (instance) replace(setDocumentEffect(session.present, instance));
                  }}
                >
                  <span className="mad-cam-effect-thumbnail" style={{ "--mad-effect-accent": effect.presentation.accent } as CSSProperties}>
                    {activeEffectThumbnails[effect.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local low-resolution object URL
                      <img src={activeEffectThumbnails[effect.id]} alt="" aria-hidden="true" />
                    ) : <span className="mad-cam-effect-placeholder" aria-hidden="true" />}
                  </span>
                  <span>{effect.name}</span>
                </button>
              ))}
            </div>
            <div className="mad-cam-look-controls">
              <label className="mad-cam-editor-range min-w-0 flex-1">
                <span>{activeEffect ? `${activeEffect.name} intensity: ${activeEffectInstance?.intensity ?? 0}%` : "Choose an effect"}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={activeEffectInstance?.intensity ?? 0}
                  disabled={!activeEffectInstance}
                  onFocus={beginTransient}
                  onPointerDown={beginTransient}
                  onChange={(event) => replace(setDocumentEffectIntensity(session.present, Number(event.target.value)), false)}
                  onBlur={commitTransient}
                  onPointerUp={commitTransient}
                  aria-label={`${activeEffect?.name ?? "Effect"} intensity`}
                  aria-valuetext={`${activeEffectInstance?.intensity ?? 0} percent`}
                />
              </label>
              <button type="button" className="mad-cam-reset-control" disabled={!activeEffectInstance} onClick={() => replace(resetDocumentEffects(session.present))}>Reset effect</button>
              <button
                type="button"
                className="mad-cam-compare-control"
                onPointerDown={() => setCompareOriginal(true)}
                onPointerUp={() => setCompareOriginal(false)}
                onPointerCancel={() => setCompareOriginal(false)}
                onPointerLeave={() => setCompareOriginal(false)}
                onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") setCompareOriginal(true); }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") setCompareOriginal(false); }}
                aria-label="Hold to compare without effects"
              >
                Hold to compare
              </button>
            </div>
          </div>
        ) : null}
        {tool === "crop" ? (
          <div className="space-y-3">
            <div className="mad-cam-editor-scroll-row">
              {CROP_PRESETS.map((preset) => <EditorChip key={preset.value} active={session.present.geometry.cropPreset === preset.value} onClick={() => applyCropPreset(preset.value)}>{preset.label}</EditorChip>)}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <EditorChip onClick={() => replace({ ...session.present, geometry: { ...session.present.geometry, rotation: rotateClockwise(session.present.geometry.rotation) } })}><RotateCw aria-hidden="true" /> Rotate</EditorChip>
              <EditorChip active={session.present.geometry.mirrored} onClick={() => replace({ ...session.present, geometry: { ...session.present.geometry, mirrored: !session.present.geometry.mirrored } })}><FlipHorizontal2 aria-hidden="true" /> Mirror</EditorChip>
              <label className="mad-cam-editor-range min-w-52"><span>Straighten</span><input type="range" min={STRAIGHTEN_RANGE.min} max={STRAIGHTEN_RANGE.max} step="1" value={session.present.geometry.straighten} onFocus={beginTransient} onPointerDown={beginTransient} onChange={(event) => replace({ ...session.present, geometry: { ...session.present.geometry, straighten: Number(event.target.value) } }, false)} onBlur={commitTransient} onPointerUp={commitTransient} aria-label="Straighten photo" /></label>
            </div>
          </div>
        ) : null}
        {tool === "adjust" ? (
          <div className="mad-cam-adjust-grid">
            {ADJUSTMENTS.map(({ key, label }) => <label key={key} className="mad-cam-editor-range"><span>{label}</span><input type="range" min="-100" max="100" value={session.present.adjustments[key]} onFocus={beginTransient} onPointerDown={beginTransient} onChange={(event) => replace(setAdjustment(session.present, key, Number(event.target.value)), false)} onBlur={commitTransient} onPointerUp={commitTransient} aria-label={label} /></label>)}
            <button type="button" className="mad-cam-reset-control" onClick={() => replace({ ...session.present, adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS } })}>Reset adjustments</button>
          </div>
        ) : null}
        {tool === "text" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button type="button" className="mad-cam-editor-add" onClick={addText}>Add text</button>
              {selectedText ? <button type="button" className="mad-cam-editor-icon" aria-label="Delete text" title="Delete text" onClick={() => { replace({ ...session.present, textOverlays: session.present.textOverlays.filter((item) => item.id !== selectedText.id) }); setSelectedTextId(null); }}><Trash2 aria-hidden="true" /></button> : null}
            </div>
            {selectedText ? <><input className="mad-cam-text-input" value={selectedText.text} maxLength={120} onFocus={beginTransient} onChange={(event) => updateText(selectedText.id, { text: event.target.value }, false)} onBlur={commitTransient} aria-label="Text content" /><div className="flex items-center gap-2 overflow-x-auto py-1">{COLORS.map((color) => <button key={color} type="button" className={cn("mad-cam-color", selectedText.color === color && "is-selected")} style={{ backgroundColor: color }} onClick={() => updateText(selectedText.id, { color })} aria-label={`Use ${color} text`} />)}{(["left", "center", "right"] as const).map((align) => <EditorChip key={align} active={selectedText.align === align} onClick={() => updateText(selectedText.id, { align })}>{align}</EditorChip>)}</div><div className="grid grid-cols-2 gap-3"><label className="mad-cam-editor-range"><span>Size</span><input type="range" min="0.04" max="0.14" step="0.005" value={selectedText.size} onFocus={beginTransient} onChange={(event) => updateText(selectedText.id, { size: Number(event.target.value) }, false)} onBlur={commitTransient} aria-label="Text size" /></label><label className="mad-cam-editor-range"><span>Rotate</span><input type="range" min="-30" max="30" step="1" value={selectedText.rotation} onFocus={beginTransient} onChange={(event) => updateText(selectedText.id, { rotation: Number(event.target.value) }, false)} onBlur={commitTransient} aria-label="Text rotation" /></label></div></> : <p className="text-sm text-white/55">Add text, then drag it into place.</p>}
          </div>
        ) : null}
        {tool === "draw" ? (
          <div className="space-y-3"><div className="flex items-center gap-2">{COLORS.map((color) => <button key={color} type="button" className={cn("mad-cam-color", drawColor === color && "is-selected")} style={{ backgroundColor: color }} onClick={() => setDrawColor(color)} aria-label={`Use ${color} brush`} />)}</div><div className="flex items-center gap-3"><label className="mad-cam-editor-range flex-1"><span>Brush size</span><input type="range" min="0.005" max="0.035" step="0.002" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="Brush size" /></label><button type="button" className="mad-cam-editor-icon" disabled={!session.present.drawingStrokes.length} aria-label="Remove last stroke" title="Remove last stroke" onClick={() => replace({ ...session.present, drawingStrokes: session.present.drawingStrokes.slice(0, -1) })}><Trash2 aria-hidden="true" /></button></div></div>
        ) : null}
      </section>

      <nav className="mad-cam-editor-tools" aria-label="Photo editing tools">
        {([
          ["looks", Sparkles, "Looks"],
          ["effects", WandSparkles, "Effects"],
          ["crop", Crop, "Crop"],
          ["adjust", SlidersHorizontal, "Adjust"],
          ["text", Type, "Text"],
          ["draw", Pencil, "Draw"]
        ] as const).map(([value, Icon, label]) => <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(value)}><Icon aria-hidden="true" /><span>{label}</span></button>)}
        <button type="button" onClick={() => dispatch({ type: "reset" })} aria-label="Reset to original"><RotateCw aria-hidden="true" /><span>Reset</span></button>
      </nav>
    </div>
  );
}

function EditorChip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={cn("mad-cam-editor-chip", active && "is-active")} onClick={onClick}>{children}</button>;
}
