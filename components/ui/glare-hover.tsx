import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./glare-hover.module.css";

type GlareHoverProps = {
  width?: string;
  height?: string;
  background?: string;
  borderRadius?: string;
  borderColor?: string;
  children?: ReactNode;
  glareColor?: string;
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
  playOnce?: boolean;
  /** Lets a pointer-transparent overlay react to its nearest `.group`. */
  triggerOnParent?: boolean;
  /** Runs a restrained periodic sweep on devices that cannot hover. */
  autoOnTouch?: boolean;
  /** Initial wait before the first touch-device sweep. */
  autoDelay?: number;
  /** Full sweep-and-rest cycle duration on touch devices. */
  autoInterval?: number;
  className?: string;
  style?: CSSProperties;
};

type GlareVariables = CSSProperties & {
  "--gh-width": string;
  "--gh-height": string;
  "--gh-bg": string;
  "--gh-br": string;
  "--gh-angle": string;
  "--gh-duration": string;
  "--gh-size": string;
  "--gh-rgba": string;
  "--gh-border": string;
  "--gh-auto-delay": string;
  "--gh-auto-duration": string;
};

export function GlareHover({
  width = "500px",
  height = "500px",
  background = "#000",
  borderRadius = "10px",
  borderColor = "#333",
  children,
  glareColor = "#ffffff",
  glareOpacity = 0.5,
  glareAngle = -45,
  glareSize = 250,
  transitionDuration = 650,
  playOnce = false,
  triggerOnParent = false,
  autoOnTouch = false,
  autoDelay = 2000,
  autoInterval = 8000,
  className,
  style
}: GlareHoverProps) {
  const rgba = colorWithOpacity(glareColor, glareOpacity);
  const variables: GlareVariables = {
    "--gh-width": width,
    "--gh-height": height,
    "--gh-bg": background,
    "--gh-br": borderRadius,
    "--gh-angle": `${glareAngle}deg`,
    "--gh-duration": `${transitionDuration}ms`,
    "--gh-size": `${glareSize}%`,
    "--gh-rgba": rgba,
    "--gh-border": borderColor,
    "--gh-auto-delay": `${Math.max(0, autoDelay)}ms`,
    "--gh-auto-duration": `${Math.max(3000, autoInterval)}ms`,
    ...style
  };

  return (
    <div
      className={cn(
        styles.glareHover,
        playOnce && styles.playOnce,
        triggerOnParent && styles.parentTrigger,
        autoOnTouch && styles.autoOnTouch,
        className
      )}
      style={variables}
      aria-hidden={children ? undefined : true}
    >
      {children}
    </div>
  );
}

function colorWithOpacity(color: string, opacity: number): string {
  const hex = color.replace("#", "");
  const alpha = Math.max(0, Math.min(1, opacity));
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
    return `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${alpha})`;
  }
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
    return `rgba(${parseInt(hex[0] + hex[0], 16)}, ${parseInt(hex[1] + hex[1], 16)}, ${parseInt(hex[2] + hex[2], 16)}, ${alpha})`;
  }
  return color;
}
