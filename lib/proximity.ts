export type ProximityLevel = "close" | "near" | "far" | "hidden";
export type ConfidenceLevel = "high" | "medium" | "low";

export const proximityLabels: Record<ProximityLevel, string> = {
  close: "Close",
  near: "Near",
  far: "Far",
  hidden: "Hidden"
};

export const confidenceLabels: Record<ConfidenceLevel, string> = {
  high: "Clear glow",
  medium: "Soft glow",
  low: "Weak signal"
};

export function getGlowClass(proximityLevel: ProximityLevel) {
  if (proximityLevel === "hidden") {
    return "proximity-halo-muted";
  }

  if (proximityLevel === "close") {
    return "proximity-halo-very-close";
  }

  if (proximityLevel === "near") {
    return "proximity-halo-nearby";
  }

  return "proximity-halo-around";
}
