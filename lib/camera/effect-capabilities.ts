import type { EffectCapabilityTier, MadEffect } from "@/lib/camera/effect-registry";

export type EffectCapabilities = {
  tier: EffectCapabilityTier;
  canvas2d: boolean;
  webgl: boolean;
  faceTracking: boolean;
  reducedMotion: boolean;
};

export function detectEffectCapabilities(scope: Window = window): EffectCapabilities {
  const canvas = scope.document.createElement("canvas");
  const canvas2d = Boolean(canvas.getContext("2d"));
  let webgl = false;
  try {
    webgl = Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    webgl = false;
  }
  const reducedMotion = scope.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return {
    tier: webgl ? "enhanced" : "canvas",
    canvas2d,
    webgl,
    // No tracking SDK is bundled in C5. Optional face effects use a deterministic fallback.
    faceTracking: false,
    reducedMotion
  };
}

export function canRenderEffect(effect: MadEffect, capabilities: EffectCapabilities) {
  if (!capabilities.canvas2d) return false;
  if (effect.minimumTier === "tracked") return capabilities.faceTracking;
  if (effect.minimumTier === "enhanced") return capabilities.webgl;
  return true;
}

