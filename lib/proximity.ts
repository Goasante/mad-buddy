export type ProximityLevel = "very_close" | "nearby" | "around" | "far" | "hidden";
export type ConfidenceLevel = "high" | "medium" | "low";

export const proximityLabels: Record<ProximityLevel, string> = {
  very_close: "Very close",
  nearby: "Nearby",
  around: "Around you",
  far: "Not glowing right now",
  hidden: "Hidden"
};

export const confidenceLabels: Record<ConfidenceLevel, string> = {
  high: "Clear glow",
  medium: "Soft glow",
  low: "Weak signal"
};

export function getGlowClass(proximityLevel: ProximityLevel) {
  if (proximityLevel === "hidden" || proximityLevel === "far") {
    return "proximity-halo-muted";
  }

  if (proximityLevel === "very_close") {
    return "proximity-halo-very-close";
  }

  if (proximityLevel === "nearby") {
    return "proximity-halo-nearby";
  }

  return "proximity-halo-around";
}
