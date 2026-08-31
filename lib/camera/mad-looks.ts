import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  clampNumber,
  type ImageAdjustments,
  type ImageEditDocument
} from "@/lib/camera/image-edit-session";

export const ORIGINAL_LOOK_ID = "original";
export const LOOK_INTENSITY_RANGE = { min: 0, max: 100 } as const;

export type MadLookCategory = "core" | "warm" | "film" | "mood" | "clean" | "dream";

export type MadLookTone = {
  shadowTint?: { color: string; amount: number };
  highlightTint?: { color: string; amount: number };
  fade?: number;
  vignette?: number;
};

export type MadLook = {
  id: string;
  name: string;
  category: MadLookCategory;
  version: number;
  defaultIntensity: number;
  adjustments: ImageAdjustments;
  tone: MadLookTone;
  presentation: {
    accent: string;
    featured?: boolean;
  };
};

const neutral = () => ({ ...DEFAULT_IMAGE_ADJUSTMENTS });

/** Platform-neutral recipes. Future native renderers can interpret the same values. */
export const MAD_LOOKS = [
  {
    id: ORIGINAL_LOOK_ID,
    name: "Original",
    category: "core",
    version: 1,
    defaultIntensity: 0,
    adjustments: neutral(),
    tone: {},
    presentation: { accent: "#D6D3D1" }
  },
  {
    id: "orange-glow",
    name: "Orange Glow",
    category: "warm",
    version: 1,
    defaultIntensity: 72,
    adjustments: { brightness: 2, contrast: 7, saturation: 4, warmth: 12 },
    tone: {
      shadowTint: { color: "#4E0401", amount: 0.045 },
      highlightTint: { color: "#F59E42", amount: 0.05 },
      vignette: 0.025
    },
    presentation: { accent: "#FF8A1F", featured: true }
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    category: "warm",
    version: 1,
    defaultIntensity: 68,
    adjustments: { brightness: 3, contrast: 4, saturation: 3, warmth: 16 },
    tone: {
      shadowTint: { color: "#6B3410", amount: 0.025 },
      highlightTint: { color: "#FFD27A", amount: 0.06 }
    },
    presentation: { accent: "#F6B84A" }
  },
  {
    id: "soft-film",
    name: "Soft Film",
    category: "film",
    version: 1,
    defaultIntensity: 64,
    adjustments: { brightness: 3, contrast: -7, saturation: -5, warmth: 4 },
    tone: {
      shadowTint: { color: "#582F3D", amount: 0.025 },
      fade: 0.055
    },
    presentation: { accent: "#D7B8A6" }
  },
  {
    id: "deep-mood",
    name: "Deep Mood",
    category: "mood",
    version: 1,
    defaultIntensity: 62,
    adjustments: { brightness: -3, contrast: 13, saturation: -7, warmth: -2 },
    tone: {
      shadowTint: { color: "#38050B", amount: 0.075 },
      vignette: 0.11
    },
    presentation: { accent: "#8D3340" }
  },
  {
    id: "clean-light",
    name: "Clean",
    category: "clean",
    version: 1,
    defaultIntensity: 70,
    adjustments: { brightness: 5, contrast: 4, saturation: -3, warmth: 0 },
    tone: { highlightTint: { color: "#FFFFFF", amount: 0.018 } },
    presentation: { accent: "#E8EEF4" }
  },
  {
    id: "soft-dream",
    name: "Dream",
    category: "dream",
    version: 1,
    defaultIntensity: 58,
    adjustments: { brightness: 5, contrast: -8, saturation: 0, warmth: 3 },
    tone: {
      highlightTint: { color: "#DCCBFF", amount: 0.045 },
      fade: 0.045
    },
    presentation: { accent: "#C9A7FF" }
  },
  {
    id: "maroon-night",
    name: "Maroon Night",
    category: "mood",
    version: 1,
    defaultIntensity: 56,
    adjustments: { brightness: -7, contrast: 12, saturation: -9, warmth: -4 },
    tone: {
      shadowTint: { color: "#35040B", amount: 0.1 },
      highlightTint: { color: "#7A86A8", amount: 0.018 },
      vignette: 0.15
    },
    presentation: { accent: "#741626" }
  }
] as const satisfies readonly MadLook[];

const LOOK_BY_ID = new Map<string, MadLook>(MAD_LOOKS.map((look) => [look.id, look]));

export function getMadLook(id: string): MadLook {
  return LOOK_BY_ID.get(id) ?? LOOK_BY_ID.get(ORIGINAL_LOOK_ID)!;
}

export function interpolateLook(look: MadLook, intensity: number) {
  const amount = clampNumber(intensity, LOOK_INTENSITY_RANGE.min, LOOK_INTENSITY_RANGE.max) / 100;
  return {
    adjustments: {
      brightness: look.adjustments.brightness * amount,
      contrast: look.adjustments.contrast * amount,
      saturation: look.adjustments.saturation * amount,
      warmth: look.adjustments.warmth * amount
    },
    tone: {
      shadowTint: look.tone.shadowTint ? { ...look.tone.shadowTint, amount: look.tone.shadowTint.amount * amount } : undefined,
      highlightTint: look.tone.highlightTint ? { ...look.tone.highlightTint, amount: look.tone.highlightTint.amount * amount } : undefined,
      fade: (look.tone.fade ?? 0) * amount,
      vignette: (look.tone.vignette ?? 0) * amount
    }
  };
}

export function setDocumentLook(document: ImageEditDocument, lookId: string, intensity?: number): ImageEditDocument {
  const look = getMadLook(lookId);
  const isOriginal = look.id === ORIGINAL_LOOK_ID;
  return {
    ...document,
    look: {
      id: look.id,
      intensity: isOriginal ? 0 : clampNumber(intensity ?? look.defaultIntensity, 0, 100),
      parameters: look.id === document.look.id ? document.look.parameters : {}
    }
  };
}

export function setDocumentLookIntensity(document: ImageEditDocument, intensity: number): ImageEditDocument {
  return {
    ...document,
    look: { ...document.look, intensity: clampNumber(intensity, 0, 100) }
  };
}

export function resetDocumentLook(document: ImageEditDocument): ImageEditDocument {
  return { ...document, look: { id: ORIGINAL_LOOK_ID, intensity: 0, parameters: {} } };
}

export function documentForOriginalComparison(document: ImageEditDocument): ImageEditDocument {
  return {
    ...resetDocumentLook(document),
    adjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
    effects: [],
    textOverlays: [],
    drawingStrokes: []
  };
}
