import type { LocalCameraImage } from "@/lib/camera/types";

export const IMAGE_EDIT_HISTORY_LIMIT = 40;
export const STRAIGHTEN_RANGE = { min: -15, max: 15 } as const;
export const IMAGE_ADJUSTMENT_RANGE = { min: -100, max: 100 } as const;

export type ImageEditorLifecycle =
  | "loading"
  | "ready"
  | "rendering_preview"
  | "exporting"
  | "failed";

export type CropPreset = "free" | "original" | "square" | "4:5" | "9:16";
export type TextAlignment = "left" | "center" | "right";

export type NormalizedPoint = { x: number; y: number };
export type NormalizedCrop = NormalizedPoint & { width: number; height: number };

export type ImageGeometry = {
  crop: NormalizedCrop;
  cropPreset: CropPreset;
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
  straighten: number;
};

export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};
export type ImageAdjustmentKey = keyof ImageAdjustments;

export type ImageTextOverlay = {
  id: string;
  text: string;
  position: NormalizedPoint;
  size: number;
  rotation: number;
  color: string;
  align: TextAlignment;
};

export type ImageDrawingStroke = {
  id: string;
  color: string;
  size: number;
  points: NormalizedPoint[];
};

export type ImageLookState = {
  id: string;
  intensity: number;
  /** Reserved for future platform-neutral Look parameters and pack versions. */
  parameters: Record<string, number>;
};

export type ImageEditDocument = {
  geometry: ImageGeometry;
  look: ImageLookState;
  adjustments: ImageAdjustments;
  textOverlays: ImageTextOverlay[];
  drawingStrokes: ImageDrawingStroke[];
};

export type ImageEditSession = {
  /** The original local blob remains the immutable source for the whole session. */
  readonly source: LocalCameraImage;
  readonly initial: ImageEditDocument;
  present: ImageEditDocument;
  past: ImageEditDocument[];
  future: ImageEditDocument[];
  lifecycle: ImageEditorLifecycle;
  error: string | null;
};

export type ImageEditAction =
  | { type: "replace"; document: ImageEditDocument; recordHistory?: boolean }
  | { type: "commit_preview"; before: ImageEditDocument }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" }
  | { type: "lifecycle"; lifecycle: ImageEditorLifecycle; error?: string | null };

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0
};

export function createImageEditDocument(): ImageEditDocument {
  return {
    geometry: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      cropPreset: "original",
      rotation: 0,
      mirrored: false,
      straighten: 0
    },
    look: { id: "original", intensity: 0, parameters: {} },
    adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
    textOverlays: [],
    drawingStrokes: []
  };
}

export function createImageEditSession(source: LocalCameraImage): ImageEditSession {
  const initial = createImageEditDocument();
  return {
    source,
    initial,
    present: initial,
    past: [],
    future: [],
    lifecycle: "loading",
    error: null
  };
}

function boundedPush(history: ImageEditDocument[], value: ImageEditDocument) {
  return [...history, value].slice(-IMAGE_EDIT_HISTORY_LIMIT);
}

function equalDocuments(a: ImageEditDocument, b: ImageEditDocument) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function imageEditReducer(session: ImageEditSession, action: ImageEditAction): ImageEditSession {
  switch (action.type) {
    case "replace":
      if (equalDocuments(session.present, action.document)) return session;
      return {
        ...session,
        present: action.document,
        past: action.recordHistory === false ? session.past : boundedPush(session.past, session.present),
        future: action.recordHistory === false ? session.future : []
      };
    case "commit_preview":
      if (equalDocuments(action.before, session.present)) return session;
      return { ...session, past: boundedPush(session.past, action.before), future: [] };
    case "undo": {
      const previous = session.past.at(-1);
      if (!previous) return session;
      return {
        ...session,
        present: previous,
        past: session.past.slice(0, -1),
        future: [session.present, ...session.future]
      };
    }
    case "redo": {
      const next = session.future[0];
      if (!next) return session;
      return {
        ...session,
        present: next,
        past: boundedPush(session.past, session.present),
        future: session.future.slice(1)
      };
    }
    case "reset":
      if (equalDocuments(session.present, session.initial)) return session;
      return {
        ...session,
        present: session.initial,
        past: boundedPush(session.past, session.present),
        future: []
      };
    case "lifecycle":
      return { ...session, lifecycle: action.lifecycle, error: action.error ?? null };
  }
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function clampNormalizedCrop(crop: NormalizedCrop): NormalizedCrop {
  const width = clampNumber(crop.width, 0.05, 1);
  const height = clampNumber(crop.height, 0.05, 1);
  return {
    x: clampNumber(crop.x, 0, 1 - width),
    y: clampNumber(crop.y, 0, 1 - height),
    width,
    height
  };
}

export function cropForPreset(
  preset: CropPreset,
  sourceWidth: number,
  sourceHeight: number,
  rotation: ImageGeometry["rotation"] = 0
): NormalizedCrop {
  if (preset === "free" || preset === "original") return { x: 0, y: 0, width: 1, height: 1 };
  const swap = rotation === 90 || rotation === 270;
  const orientedWidth = swap ? sourceHeight : sourceWidth;
  const orientedHeight = swap ? sourceWidth : sourceHeight;
  const sourceAspect = orientedWidth / orientedHeight;
  const targetAspect = preset === "square" ? 1 : preset === "4:5" ? 4 / 5 : 9 / 16;
  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = sourceAspect / targetAspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function rotateClockwise(rotation: ImageGeometry["rotation"]): ImageGeometry["rotation"] {
  return ((rotation + 90) % 360) as ImageGeometry["rotation"];
}

export function setAdjustment(
  document: ImageEditDocument,
  key: keyof ImageAdjustments,
  value: number
): ImageEditDocument {
  return {
    ...document,
    adjustments: {
      ...document.adjustments,
      [key]: clampNumber(value, IMAGE_ADJUSTMENT_RANGE.min, IMAGE_ADJUSTMENT_RANGE.max)
    }
  };
}

export function hasImageEdits(document: ImageEditDocument) {
  return !equalDocuments(document, createImageEditDocument());
}
