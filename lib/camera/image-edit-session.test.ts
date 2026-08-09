import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  IMAGE_EDIT_HISTORY_LIMIT,
  clampNormalizedCrop,
  createImageEditSession,
  cropForPreset,
  hasImageEdits,
  imageEditReducer,
  rotateClockwise,
  setAdjustment,
  type ImageEditDocument
} from "@/lib/camera/image-edit-session";
import type { LocalCameraImage } from "@/lib/camera/types";

const source: LocalCameraImage = {
  kind: "image",
  source: "camera",
  blob: new Blob(["original"], { type: "image/jpeg" }),
  file: new File(["original"], "original.jpg", { type: "image/jpeg" }),
  mime: "image/jpeg",
  width: 1200,
  height: 1600,
  objectUrl: "blob:original",
  pixelsMirrored: true
};

function replacement(document: ImageEditDocument, brightness: number) {
  return setAdjustment(document, "brightness", brightness);
}

describe("canonical image edit session", () => {
  it("keeps the original local source immutable while documents change", () => {
    const session = createImageEditSession(source);
    const changed = imageEditReducer(session, { type: "replace", document: replacement(session.present, 30) });
    expect(changed.source).toBe(source);
    expect(changed.source.blob).toBe(source.blob);
    expect(changed.source.pixelsMirrored).toBe(true);
    expect(session.present.adjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);
    expect(changed.present.adjustments.brightness).toBe(30);
  });

  it("creates normalized crop presets for portrait and landscape sources", () => {
    expect(cropForPreset("square", 1200, 1600)).toEqual({ x: 0, y: 0.125, width: 1, height: 0.75 });
    const fourFive = cropForPreset("4:5", 1600, 1200);
    expect(fourFive.x).toBeCloseTo(0.2);
    expect(fourFive.width).toBeCloseTo(0.6);
    expect({ y: fourFive.y, height: fourFive.height }).toEqual({ y: 0, height: 1 });
    const portrait = cropForPreset("9:16", 1600, 1200, 90);
    expect(portrait).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
  });

  it("clamps free crops and adjustment ranges", () => {
    expect(clampNormalizedCrop({ x: -1, y: 2, width: 2, height: 0 })).toEqual({ x: 0, y: 0.95, width: 1, height: 0.05 });
    const initial = createImageEditSession(source).present;
    expect(setAdjustment(initial, "contrast", 500).adjustments.contrast).toBe(100);
    expect(setAdjustment(initial, "warmth", -500).adjustments.warmth).toBe(-100);
  });

  it("rotates in deterministic 90 degree steps without double-mirroring a front capture", () => {
    expect(([0, 90, 180, 270] as const).map(rotateClockwise)).toEqual([90, 180, 270, 0]);
    const session = createImageEditSession(source);
    expect(session.present.geometry.mirrored).toBe(false);
    expect(session.source.pixelsMirrored).toBe(true);
  });

  it("undoes and redoes text and drawing changes as complete documents", () => {
    const session = createImageEditSession(source);
    const withText = {
      ...session.present,
      textOverlays: [{ id: "text", text: "Hello", position: { x: 0.5, y: 0.5 }, size: 0.08, rotation: 0, color: "#fff", align: "center" as const }]
    };
    const textSession = imageEditReducer(session, { type: "replace", document: withText });
    const withStroke = {
      ...textSession.present,
      drawingStrokes: [{ id: "stroke", color: "#fff", size: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }]
    };
    const drawn = imageEditReducer(textSession, { type: "replace", document: withStroke });
    const undo = imageEditReducer(drawn, { type: "undo" });
    const redo = imageEditReducer(undo, { type: "redo" });
    expect(undo.present.drawingStrokes).toHaveLength(0);
    expect(undo.present.textOverlays).toHaveLength(1);
    expect(redo.present.drawingStrokes).toHaveLength(1);
  });

  it("commits a continuous preview as one history entry", () => {
    const session = createImageEditSession(source);
    const before = session.present;
    const previewOne = imageEditReducer(session, { type: "replace", document: replacement(session.present, 10), recordHistory: false });
    const previewTwo = imageEditReducer(previewOne, { type: "replace", document: replacement(previewOne.present, 50), recordHistory: false });
    const committed = imageEditReducer(previewTwo, { type: "commit_preview", before });
    expect(committed.past).toHaveLength(1);
    expect(imageEditReducer(committed, { type: "undo" }).present.adjustments.brightness).toBe(0);
  });

  it("bounds history and makes reset undoable", () => {
    let session = createImageEditSession(source);
    for (let index = 1; index <= IMAGE_EDIT_HISTORY_LIMIT + 8; index += 1) {
      session = imageEditReducer(session, { type: "replace", document: replacement(session.present, index) });
    }
    expect(session.past).toHaveLength(IMAGE_EDIT_HISTORY_LIMIT);
    const reset = imageEditReducer(session, { type: "reset" });
    expect(hasImageEdits(reset.present)).toBe(false);
    expect(imageEditReducer(reset, { type: "undo" }).present.adjustments.brightness).toBe(48);
  });

  it("tracks editor lifecycle without creating history", () => {
    const session = createImageEditSession(source);
    const exporting = imageEditReducer(session, { type: "lifecycle", lifecycle: "exporting" });
    const failed = imageEditReducer(exporting, { type: "lifecycle", lifecycle: "failed", error: "failed" });
    expect(exporting.past).toHaveLength(0);
    expect(failed).toMatchObject({ lifecycle: "failed", error: "failed" });
  });
});
