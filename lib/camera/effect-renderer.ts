import type { EffectInstance } from "@/lib/camera/effect-document";
import { getMadEffect } from "@/lib/camera/effect-registry";
import type { FaceTrackingResult } from "@/lib/camera/face-tracking";

export type EffectRenderOptions = {
  timeMs?: number;
  reducedMotion?: boolean;
  primaryFace?: FaceTrackingResult | null;
};

type SubjectGeometry = { x: number; y: number; radiusX: number; radiusY: number };

export function renderImageEffects(
  context: CanvasRenderingContext2D,
  effects: EffectInstance[],
  width: number,
  height: number,
  options: EffectRenderOptions = {}
) {
  for (const instance of effects) {
    const definition = getMadEffect(instance.effectId);
    if (!definition || definition.version !== instance.version || instance.intensity <= 0) continue;
    const amount = Math.min(1, Math.max(0, instance.intensity / 100));
    const subject = subjectGeometry(width, height, options.primaryFace);
    switch (definition.renderer) {
      case "mad_glow":
        drawMadGlow(context, subject, amount);
        break;
      case "spark_halo":
        drawSparkHalo(context, subject, amount, options.reducedMotion ? 0 : (options.timeMs ?? 0));
        break;
      case "golden_light":
        drawGoldenLight(context, width, height, amount);
        break;
      case "after_dark":
        drawAfterDark(context, width, height, amount);
        break;
      case "soft_aura":
        drawSoftAura(context, subject, amount);
        break;
      case "clean_frame":
        drawCleanFrame(context, width, height, amount);
        break;
    }
  }
}

function subjectGeometry(width: number, height: number, face?: FaceTrackingResult | null): SubjectGeometry {
  if (face) {
    const bounds = face.bounds;
    return {
      x: (bounds.x + bounds.width / 2) * width,
      y: (bounds.y + bounds.height / 2) * height,
      radiusX: Math.max(width * 0.12, bounds.width * width * 0.72),
      radiusY: Math.max(height * 0.15, bounds.height * height * 0.72)
    };
  }
  return {
    x: width * 0.5,
    y: height * 0.43,
    radiusX: Math.min(width, height) * 0.23,
    radiusY: Math.min(width, height) * 0.3
  };
}

function drawMadGlow(context: CanvasRenderingContext2D, subject: SubjectGeometry, amount: number) {
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.34 * amount;
  context.strokeStyle = "#FF7A12";
  context.lineWidth = Math.max(2, subject.radiusX * 0.055);
  context.shadowColor = "#FF6A00";
  context.shadowBlur = subject.radiusX * (0.24 + amount * 0.32);
  context.beginPath();
  context.ellipse(subject.x, subject.y, subject.radiusX, subject.radiusY, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawSparkHalo(context: CanvasRenderingContext2D, subject: SubjectGeometry, amount: number, timeMs: number) {
  context.save();
  context.globalCompositeOperation = "screen";
  const phase = timeMs / 9000 * Math.PI * 2;
  for (let index = 0; index < 8; index += 1) {
    const angle = phase + index / 8 * Math.PI * 2;
    const x = subject.x + Math.cos(angle) * subject.radiusX * 1.18;
    const y = subject.y + Math.sin(angle) * subject.radiusY * 1.05;
    const radius = Math.max(1.5, subject.radiusX * (index % 3 === 0 ? 0.026 : 0.016));
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius * 3.2);
    gradient.addColorStop(0, `rgba(255,246,196,${0.9 * amount})`);
    gradient.addColorStop(1, "rgba(255,190,72,0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius * 3.2, y - radius * 3.2, radius * 6.4, radius * 6.4);
  }
  context.restore();
}

function drawGoldenLight(context: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  const radius = Math.max(width, height) * 0.8;
  const gradient = context.createRadialGradient(width * 0.12, height * 0.12, 0, width * 0.12, height * 0.12, radius);
  gradient.addColorStop(0, `rgba(255,225,151,${0.32 * amount})`);
  gradient.addColorStop(0.45, `rgba(255,157,54,${0.12 * amount})`);
  gradient.addColorStop(1, "rgba(255,122,18,0)");
  context.save();
  context.globalCompositeOperation = "screen";
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawAfterDark(context: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  context.save();
  context.globalCompositeOperation = "multiply";
  context.globalAlpha = 0.28 * amount;
  context.fillStyle = "#101731";
  context.fillRect(0, 0, width, height);
  context.restore();
  const vignette = context.createRadialGradient(width / 2, height * 0.44, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, "rgba(3,7,20,0)");
  vignette.addColorStop(1, `rgba(3,7,20,${0.48 * amount})`);
  context.save();
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawSoftAura(context: CanvasRenderingContext2D, subject: SubjectGeometry, amount: number) {
  const outer = Math.max(subject.radiusX, subject.radiusY) * 2.3;
  const gradient = context.createRadialGradient(subject.x, subject.y, subject.radiusX * 0.5, subject.x, subject.y, outer);
  gradient.addColorStop(0, "rgba(201,167,255,0)");
  gradient.addColorStop(0.42, `rgba(168,85,247,${0.16 * amount})`);
  gradient.addColorStop(1, "rgba(77,43,134,0)");
  context.save();
  context.globalCompositeOperation = "screen";
  context.fillStyle = gradient;
  context.fillRect(subject.x - outer, subject.y - outer, outer * 2, outer * 2);
  context.restore();
}

function drawCleanFrame(context: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  const inset = Math.max(8, Math.min(width, height) * 0.025);
  context.save();
  context.globalAlpha = 0.48 * amount;
  context.strokeStyle = "#F8FAFC";
  context.lineWidth = Math.max(2, Math.min(width, height) * 0.006);
  context.shadowColor = "rgba(255,255,255,.45)";
  context.shadowBlur = Math.min(width, height) * 0.018;
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  context.restore();
}
