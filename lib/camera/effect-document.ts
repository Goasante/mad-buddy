import type { ImageEditDocument } from "@/lib/camera/image-edit-session";

export type EffectCategory = "signature" | "light" | "mood" | "frame";
export type EffectTrackingMode = "none" | "primary_face_optional";

/**
 * Platform-neutral effect state. Face geometry is deliberately excluded: tracking
 * results are ephemeral render inputs and must never be persisted in edit documents.
 */
export type EffectInstance = {
  effectId: string;
  version: number;
  intensity: number;
  parameters: Record<string, number>;
  tracking: {
    mode: EffectTrackingMode;
  };
};

export const EFFECT_INTENSITY_RANGE = { min: 0, max: 100 } as const;

function clampIntensity(value: number) {
  if (!Number.isFinite(value)) return EFFECT_INTENSITY_RANGE.min;
  return Math.min(EFFECT_INTENSITY_RANGE.max, Math.max(EFFECT_INTENSITY_RANGE.min, value));
}

export function createEffectInstance(
  id: string,
  version: number,
  intensity: number,
  trackingMode: EffectTrackingMode,
  parameters: Record<string, number> = {}
): EffectInstance {
  return {
    effectId: id,
    version,
    intensity: clampIntensity(intensity),
    parameters: { ...parameters },
    tracking: { mode: trackingMode }
  };
}

export function setDocumentEffect(document: ImageEditDocument, effect: EffectInstance): ImageEditDocument {
  return { ...document, effects: [{ ...effect, parameters: { ...effect.parameters }, tracking: { ...effect.tracking } }] };
}

export function setDocumentEffectIntensity(document: ImageEditDocument, intensity: number): ImageEditDocument {
  const active = document.effects[0];
  if (!active) return document;
  return {
    ...document,
    effects: [{ ...active, intensity: clampIntensity(intensity) }, ...document.effects.slice(1)]
  };
}

export function resetDocumentEffects(document: ImageEditDocument): ImageEditDocument {
  return document.effects.length ? { ...document, effects: [] } : document;
}
