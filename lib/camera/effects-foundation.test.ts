import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canRenderEffect, type EffectCapabilities } from "@/lib/camera/effect-capabilities";
import {
  resetDocumentEffects,
  setDocumentEffect,
  setDocumentEffectIntensity
} from "@/lib/camera/effect-document";
import { effectInstanceFor, getMadEffect, MAD_EFFECTS } from "@/lib/camera/effect-registry";
import { renderImageEffects } from "@/lib/camera/effect-renderer";
import { selectPrimaryFace } from "@/lib/camera/face-tracking";
import {
  createImageEditDocument,
  createImageEditSession,
  imageEditReducer
} from "@/lib/camera/image-edit-session";
import type { LocalCameraImage } from "@/lib/camera/types";

const source: LocalCameraImage = {
  kind: "image",
  source: "camera",
  blob: new Blob(["image"]),
  file: new File(["image"], "image.jpg", { type: "image/jpeg" }),
  mime: "image/jpeg",
  width: 1200,
  height: 900,
  objectUrl: "blob:image"
};

function context() {
  const gradient = { addColorStop: vi.fn() };
  return {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(),
    ellipse: vi.fn(), stroke: vi.fn(), createRadialGradient: vi.fn(() => gradient),
    globalCompositeOperation: "source-over", globalAlpha: 1, fillStyle: "", strokeStyle: "",
    lineWidth: 1, shadowColor: "", shadowBlur: 0
  } as unknown as CanvasRenderingContext2D;
}

describe("Mad Cam C5 canonical effects foundation", () => {
  it("ships one small, unique, versioned registry with the signature Mad Glow", () => {
    expect(MAD_EFFECTS).toHaveLength(6);
    expect(new Set(MAD_EFFECTS.map((effect) => effect.id)).size).toBe(MAD_EFFECTS.length);
    expect(getMadEffect("mad-glow")).toMatchObject({ name: "Mad Glow", presentation: { featured: true } });
    expect(getMadEffect("unknown")).toBeNull();
    for (const effect of MAD_EFFECTS) {
      expect(effect.version).toBeGreaterThan(0);
      expect(effect.defaultIntensity).toBeGreaterThan(0);
      expect(effect.defaultIntensity).toBeLessThanOrEqual(100);
    }
  });

  it("stores platform-neutral effect state and records selection, intensity and reset in history", () => {
    const effect = effectInstanceFor("soft-aura")!;
    const selectedDocument = setDocumentEffect(createImageEditDocument(), effect);
    const session = createImageEditSession(source);
    const selected = imageEditReducer(session, { type: "replace", document: selectedDocument });
    const preview = imageEditReducer(selected, {
      type: "replace",
      document: setDocumentEffectIntensity(selected.present, 28),
      recordHistory: false
    });
    const committed = imageEditReducer(preview, { type: "commit_preview", before: selected.present });
    const reset = imageEditReducer(committed, { type: "replace", document: resetDocumentEffects(committed.present) });
    expect(committed.present.effects[0]).toMatchObject({ effectId: "soft-aura", intensity: 28 });
    expect(reset.present.effects).toEqual([]);
    expect(imageEditReducer(reset, { type: "undo" }).present.effects[0].intensity).toBe(28);
  });

  it("supports a seeded camera effect while preserving Reset to the original", () => {
    const seededDocument = setDocumentEffect(createImageEditDocument(), effectInstanceFor("mad-glow")!);
    const session = createImageEditSession(source, seededDocument);
    expect(session.present.effects[0].effectId).toBe("mad-glow");
    expect(session.past).toEqual([session.initial]);
    expect(imageEditReducer(session, { type: "reset" }).present.effects).toEqual([]);
  });

  it("renders every launch effect through the shared Canvas stage and honors static reduced motion", () => {
    for (const effect of MAD_EFFECTS) {
      const canvasContext = context();
      renderImageEffects(canvasContext, [effectInstanceFor(effect.id)!], 800, 600, {
        timeMs: 5000,
        reducedMotion: true
      });
      expect(canvasContext.save).toHaveBeenCalled();
      expect(canvasContext.restore).toHaveBeenCalled();
    }
  });

  it("uses Canvas fallbacks when face tracking is absent and never disables launch effects", () => {
    const basic: EffectCapabilities = {
      tier: "canvas",
      canvas2d: true,
      webgl: false,
      faceTracking: false,
      reducedMotion: true
    };
    expect(MAD_EFFECTS.every((effect) => canRenderEffect(effect, basic))).toBe(true);
    expect(MAD_EFFECTS.filter((effect) => effect.trackingMode !== "none").length).toBeGreaterThan(0);
  });

  it("selects only a valid primary face and keeps geometry outside persisted effect state", () => {
    const primary = selectPrimaryFace([
      { bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9, capturedAt: 1 },
      { bounds: { x: 0.2, y: 0.15, width: 0.4, height: 0.45 }, confidence: 0.8, capturedAt: 1 },
      { bounds: { x: -1, y: 0, width: 2, height: 2 }, confidence: 1, capturedAt: 1 }
    ]);
    expect(primary?.bounds.width).toBe(0.4);
    const serialized = JSON.stringify(setDocumentEffect(createImageEditDocument(), effectInstanceFor("mad-glow")!));
    expect(serialized).not.toContain("bounds");
    expect(serialized).not.toContain("landmark");
    expect(serialized).not.toContain("confidence");
  });

  it("keeps effects local, lazy and inside the existing camera and renderer boundaries", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const editor = read("components/camera/image-editor.tsx");
    const composer = read("components/camera/camera-composer.tsx");
    const renderer = read("lib/camera/image-renderer.ts");
    const effectSources = [
      "effect-document.ts",
      "effect-registry.ts",
      "effect-capabilities.ts",
      "effect-renderer.ts",
      "effect-thumbnails.ts",
      "face-tracking.ts"
    ].map((file) => read(`lib/camera/${file}`)).join("\n").toLowerCase();
    expect(editor).toContain('aria-label="Mad Effects"');
    expect(editor).toContain("generateEffectThumbnails");
    expect(composer).toContain('dynamic(() => import("@/components/camera/image-editor")');
    expect(composer).toContain("renderImageEffects");
    expect(renderer).toContain("renderImageEffects(context, document.effects");
    for (const forbidden of ["supabase", "fetch(", "xmlhttprequest", "localstorage", "sessionstorage", "mediapipe"]) {
      expect(effectSources).not.toContain(forbidden);
    }
  });
});
