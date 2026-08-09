import { describe, expect, it } from "vitest";
import { createImageEditDocument, createImageEditSession, imageEditReducer, setAdjustment } from "@/lib/camera/image-edit-session";
import {
  MAD_LOOKS,
  ORIGINAL_LOOK_ID,
  documentForOriginalComparison,
  getMadLook,
  interpolateLook,
  resetDocumentLook,
  setDocumentLook,
  setDocumentLookIntensity
} from "@/lib/camera/mad-looks";
import type { MadLook } from "@/lib/camera/mad-looks";
import type { LocalCameraImage } from "@/lib/camera/types";

const source: LocalCameraImage = {
  kind: "image", source: "camera", blob: new Blob(["image"]), file: new File(["image"], "image.jpg"),
  mime: "image/jpeg", width: 1200, height: 900, objectUrl: "blob:image"
};

describe("canonical Mad Looks registry", () => {
  it("ships a small unique data-driven launch set with the signature Orange Glow", () => {
    expect(MAD_LOOKS).toHaveLength(8);
    expect(new Set(MAD_LOOKS.map((look) => look.id)).size).toBe(MAD_LOOKS.length);
    expect(MAD_LOOKS.find((look) => look.id === "orange-glow")).toMatchObject({
      name: "Orange Glow",
      presentation: { featured: true }
    });
    for (const look of MAD_LOOKS as readonly MadLook[]) {
      expect(look.version).toBeGreaterThan(0);
      expect(look.defaultIntensity).toBeGreaterThanOrEqual(0);
      expect(look.defaultIntensity).toBeLessThanOrEqual(100);
    }
  });

  it("keeps Original a true identity recipe and safely falls back to it", () => {
    const original = getMadLook(ORIGINAL_LOOK_ID);
    expect(original.adjustments).toEqual({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
    expect(original.tone).toEqual({});
    expect(getMadLook("unknown").id).toBe(ORIGINAL_LOOK_ID);
    expect(interpolateLook(getMadLook("orange-glow"), 0).adjustments).toEqual({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
  });

  it("interpolates from neutral to the full recipe without moving neutral points", () => {
    const look = getMadLook("orange-glow");
    expect(interpolateLook(look, 100).adjustments).toEqual(look.adjustments);
    expect(interpolateLook(look, 50).adjustments).toEqual({ brightness: 1, contrast: 3.5, saturation: 2, warmth: 6 });
    expect(interpolateLook(look, 500)).toEqual(interpolateLook(look, 100));
  });

  it("keeps launch recipes within conservative portrait-safe bounds", () => {
    for (const look of MAD_LOOKS as readonly MadLook[]) {
      expect(look.adjustments.brightness).toBeGreaterThanOrEqual(-10);
      expect(look.adjustments.brightness).toBeLessThanOrEqual(8);
      expect(look.adjustments.contrast).toBeGreaterThanOrEqual(-10);
      expect(look.adjustments.contrast).toBeLessThanOrEqual(15);
      expect(look.adjustments.saturation).toBeGreaterThanOrEqual(-12);
      expect(look.adjustments.saturation).toBeLessThanOrEqual(8);
      expect(look.adjustments.warmth).toBeGreaterThanOrEqual(-6);
      expect(look.adjustments.warmth).toBeLessThanOrEqual(18);
      expect(look.tone.shadowTint?.amount ?? 0).toBeLessThanOrEqual(0.1);
      expect(look.tone.highlightTint?.amount ?? 0).toBeLessThanOrEqual(0.06);
      expect(look.tone.fade ?? 0).toBeLessThanOrEqual(0.06);
      expect(look.tone.vignette ?? 0).toBeLessThanOrEqual(0.15);
    }
  });

  it("keeps Look recipes separate from manual adjustments", () => {
    const manual = setAdjustment(createImageEditDocument(), "contrast", 25);
    const looked = setDocumentLook(manual, "soft-film", 60);
    expect(looked.look).toMatchObject({ id: "soft-film", intensity: 60 });
    expect(looked.adjustments.contrast).toBe(25);
    expect(resetDocumentLook(looked).adjustments.contrast).toBe(25);
  });

  it("records Look selection and one batched intensity gesture in undo history", () => {
    const session = createImageEditSession(source);
    const selected = imageEditReducer(session, { type: "replace", document: setDocumentLook(session.present, "deep-mood") });
    const before = selected.present;
    const previewOne = imageEditReducer(selected, { type: "replace", document: setDocumentLookIntensity(selected.present, 30), recordHistory: false });
    const previewTwo = imageEditReducer(previewOne, { type: "replace", document: setDocumentLookIntensity(previewOne.present, 72), recordHistory: false });
    const committed = imageEditReducer(previewTwo, { type: "commit_preview", before });
    expect(committed.past).toHaveLength(2);
    expect(imageEditReducer(committed, { type: "undo" }).present.look.intensity).toBe(getMadLook("deep-mood").defaultIntensity);
    expect(imageEditReducer(imageEditReducer(committed, { type: "undo" }), { type: "undo" }).present.look.id).toBe(ORIGINAL_LOOK_ID);
  });

  it("resets only the Look or compares a clean original without mutating the document", () => {
    const document = setAdjustment(setDocumentLook(createImageEditDocument(), "maroon-night", 80), "brightness", 20);
    document.textOverlays = [{ id: "t", text: "Hi", position: { x: 0.5, y: 0.5 }, size: 0.1, rotation: 0, color: "#fff", align: "center" }];
    const lookReset = resetDocumentLook(document);
    const comparison = documentForOriginalComparison(document);
    expect(lookReset.adjustments.brightness).toBe(20);
    expect(comparison).toMatchObject({ look: { id: ORIGINAL_LOOK_ID, intensity: 0 }, adjustments: { brightness: 0 } });
    expect(comparison.textOverlays).toHaveLength(0);
    expect(document.look.id).toBe("maroon-night");
  });

  it("keeps the existing full Reset All behavior for Looks and every other edit layer", () => {
    const session = createImageEditSession(source);
    const edited = imageEditReducer(session, {
      type: "replace",
      document: setAdjustment(setDocumentLook(session.present, "orange-glow", 44), "warmth", -12)
    });
    const reset = imageEditReducer(edited, { type: "reset" });
    expect(reset.present).toEqual(session.initial);
    expect(reset.present.look).toEqual({ id: ORIGINAL_LOOK_ID, intensity: 0, parameters: {} });
    expect(imageEditReducer(reset, { type: "undo" }).present.look).toMatchObject({ id: "orange-glow", intensity: 44 });
  });
});
