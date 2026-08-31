import { createEffectInstance, type EffectCategory, type EffectInstance, type EffectTrackingMode } from "@/lib/camera/effect-document";

export type EffectCapabilityTier = "canvas" | "enhanced" | "tracked";
export type EffectRendererKind = "mad_glow" | "spark_halo" | "golden_light" | "after_dark" | "soft_aura" | "clean_frame";

export type MadEffect = {
  id: string;
  name: string;
  description: string;
  category: EffectCategory;
  version: number;
  defaultIntensity: number;
  renderer: EffectRendererKind;
  intensityRange: { min: number; max: number };
  minimumTier: EffectCapabilityTier;
  trackingMode: EffectTrackingMode;
  supportedPlatforms: readonly ["web", "ios", "android"];
  assets: readonly string[];
  requirements: {
    faceTracking: boolean;
    segmentation: boolean;
    webgl: boolean;
    liveInput: boolean;
  };
  fallback: "canvas_subject_anchor" | "canvas_scene";
  animated: boolean;
  catalog: {
    featured: boolean;
    seasonal: boolean;
    packId: string;
    entitlement: "free";
    availableFrom: string | null;
    availableUntil: string | null;
  };
  presentation: {
    accent: string;
    featured?: boolean;
  };
};

/** Small, versioned launch catalogue. It is intentionally data-driven for future packs. */
export const MAD_EFFECTS = [
  {
    id: "mad-glow",
    name: "Mad Glow",
    description: "A warm signature glow around the subject.",
    category: "signature",
    version: 1,
    defaultIntensity: 72,
    renderer: "mad_glow",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "primary_face_optional",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_subject_anchor",
    animated: false,
    catalog: { featured: true, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#FF7A12", featured: true }
  },
  {
    id: "spark-halo",
    name: "Spark Halo",
    description: "A light halo with slow, restrained sparks.",
    category: "signature",
    version: 1,
    defaultIntensity: 58,
    renderer: "spark_halo",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "primary_face_optional",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_subject_anchor",
    animated: true,
    catalog: { featured: false, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#FFD27A" }
  },
  {
    id: "golden-light",
    name: "Golden Light",
    description: "Soft sunlight from the edge of the frame.",
    category: "light",
    version: 1,
    defaultIntensity: 62,
    renderer: "golden_light",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "none",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_scene",
    animated: false,
    catalog: { featured: false, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#F6B84A" }
  },
  {
    id: "after-dark",
    name: "After Dark",
    description: "A calm night scene with deep edges.",
    category: "mood",
    version: 1,
    defaultIntensity: 54,
    renderer: "after_dark",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "none",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_scene",
    animated: false,
    catalog: { featured: false, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#5965B6" }
  },
  {
    id: "soft-aura",
    name: "Soft Aura",
    description: "A gentle violet aura behind the subject.",
    category: "light",
    version: 1,
    defaultIntensity: 48,
    renderer: "soft_aura",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "primary_face_optional",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_subject_anchor",
    animated: false,
    catalog: { featured: false, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#C9A7FF" }
  },
  {
    id: "clean-frame",
    name: "Clean Frame",
    description: "A minimal bright frame with quiet depth.",
    category: "frame",
    version: 1,
    defaultIntensity: 64,
    renderer: "clean_frame",
    intensityRange: { min: 0, max: 100 },
    minimumTier: "canvas",
    trackingMode: "none",
    supportedPlatforms: ["web", "ios", "android"],
    assets: [],
    requirements: { faceTracking: false, segmentation: false, webgl: false, liveInput: false },
    fallback: "canvas_scene",
    animated: false,
    catalog: { featured: false, seasonal: false, packId: "c5-launch", entitlement: "free", availableFrom: null, availableUntil: null },
    presentation: { accent: "#E8EEF4" }
  }
] as const satisfies readonly MadEffect[];

const EFFECT_BY_ID = new Map<string, MadEffect>(MAD_EFFECTS.map((effect) => [effect.id, effect]));

export function getMadEffect(id: string): MadEffect | null {
  return EFFECT_BY_ID.get(id) ?? null;
}

export function effectInstanceFor(id: string, intensity?: number): EffectInstance | null {
  const effect = getMadEffect(id);
  if (!effect) return null;
  return createEffectInstance(
    effect.id,
    effect.version,
    intensity ?? effect.defaultIntensity,
    effect.trackingMode
  );
}
