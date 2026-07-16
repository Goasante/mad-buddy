"use client";

import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import styles from "./ferrofluid.module.css";

const MAX_COLORS = 8;

type FlowDirection = "up" | "down" | "left" | "right";

type FerrofluidProps = {
  className?: string;
  colors?: string[];
  speed?: number;
  scale?: number;
  turbulence?: number;
  fluidity?: number;
  rimWidth?: number;
  sharpness?: number;
  shimmer?: number;
  glow?: number;
  flowDirection?: FlowDirection;
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  mouseDampening?: number;
  paused?: boolean;
  dpr?: number;
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "").padEnd(6, "0");
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255
  ];
}

function prepareColors(input: string[]) {
  const base = (input.length ? input : ["#8b5cf6", "#3b82f6", "#34d399"]).slice(0, MAX_COLORS);
  const colors = Array.from({ length: MAX_COLORS }, (_, index) => hexToRgb(base[Math.min(index, base.length - 1)]));
  return { colors, count: base.length };
}

const flowVectors: Record<FlowDirection, [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0]
};

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = `
precision highp float;
uniform vec3 iResolution;
uniform vec2 iMouse;
uniform float iTime;
uniform vec3 uColor0; uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;
uniform vec3 uColor4; uniform vec3 uColor5; uniform vec3 uColor6; uniform vec3 uColor7;
uniform int uColorCount;
uniform vec2 uFlow;
uniform float uSpeed; uniform float uScale; uniform float uTurbulence; uniform float uFluidity;
uniform float uRimWidth; uniform float uSharpness; uniform float uShimmer; uniform float uGlow;
uniform float uOpacity; uniform float uMouseEnabled; uniform float uMouseStrength; uniform float uMouseRadius;
varying vec2 vUv;
#define PI 3.14159265
vec3 palette(float h) {
  int count = uColorCount; if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0; if (idx == 1) return uColor1; if (idx == 2) return uColor2;
  if (idx == 3) return uColor3; if (idx == 4) return uColor4; if (idx == 5) return uColor5;
  if (idx == 6) return uColor6; return uColor7;
}
float hash(vec3 p3) {
  p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float smin(float a, float b, float k) {
  float r = exp2(-a / k) + exp2(-b / k); return -k * log2(r);
}
float sinlerp(float a, float b, float w) { return mix(a, b, (sin(w * PI - PI / 2.0) + 1.0) / 2.0); }
float vn(vec2 p, float s, float seed) {
  vec2 cellp = floor(p / s); vec2 relp = mod(p, s);
  float g1 = hash(vec3(cellp, seed)); float g2 = hash(vec3(cellp.x + 1.0, cellp.y, seed));
  float g3 = hash(vec3(cellp.x + 1.0, cellp.y + 1.0, seed)); float g4 = hash(vec3(cellp, seed) + vec3(0.0, 1.0, 0.0));
  return sinlerp(sinlerp(g1, g2, relp.x / s), sinlerp(g4, g3, relp.x / s), relp.y / s);
}
float dbn(vec2 p, float s, float seed) {
  float o = s / 2.0;
  return (2.0 * vn(p, s, seed) + 1.5 * vn(p + vec2(o), s, seed + 0.1) +
    1.25 * vn(p + vec2(-o, o), s, seed + 0.2) + 1.125 * vn(p + vec2(o, -o), s, seed + 0.3) +
    vn(p - vec2(o), s, seed + 0.4)) / 7.0;
}
void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  float ref = 700.0 / max(uScale, 0.05); vec2 p = fragCoord / iResolution.y * ref;
  float spd = 200.0 * uSpeed; float t = iTime; vec2 dir = uFlow; vec2 perp = vec2(-dir.y, dir.x);
  float distort1 = vn(p + perp * (t * spd), 60.0, 10.0) * 50.0 * uTurbulence;
  float distort2 = vn(p - perp * (t * spd), 120.0, 15.0) * 100.0 * uTurbulence;
  float peaks = dbn(p + distort1 + dir * (t * spd * 0.5), 40.0, 1.0);
  float peaks2 = dbn(p + distort2 - dir * (t * spd * 0.5), 40.0, 0.0);
  float merged = smin(peaks, peaks2, max(uFluidity, 0.001));
  float mouseGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mp = iMouse / iResolution.y * ref; float md = length(p - mp) / ref;
    float radius = max(uMouseRadius, 0.02); mouseGlow = exp(-md * md / (radius * radius)) * uMouseStrength;
  }
  float band = (uRimWidth - abs((merged - 0.4) * 2.0)) * 5.0;
  float light = clamp(band - vn(p + dir * (t * spd * 0.5), 60.0, 12.0) * uShimmer, 0.0, 1.0);
  light = pow(light, uSharpness) * uGlow * clamp(1.0 - mouseGlow, 0.0, 1.0);
  vec3 color = palette(clamp(0.5 + (peaks - peaks2) * 0.8, 0.0, 1.0)) * light;
  float alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;

export function Ferrofluid({
  className = "",
  colors = ["#a855f7", "#3b82f6", "#34d399"],
  speed = 0.22,
  scale = 1.35,
  turbulence = 0.85,
  fluidity = 0.12,
  rimWidth = 0.18,
  sharpness = 2.7,
  shimmer = 0.85,
  glow = 1.7,
  flowDirection = "down",
  opacity = 0.72,
  mouseInteraction = true,
  mouseStrength = 0.8,
  mouseRadius = 0.28,
  mouseDampening = 0.15,
  paused = false,
  dpr = 1.25
}: FerrofluidProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({ dpr: Math.min(dpr, 1.5), alpha: true, antialias: false });
    const gl = renderer.gl;
    const canvas = gl.canvas;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(canvas);

    const prepared = prepareColors(colors);
    const uniforms = {
      iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] },
      iMouse: { value: [0, 0] }, iTime: { value: 0 },
      uColor0: { value: prepared.colors[0] }, uColor1: { value: prepared.colors[1] },
      uColor2: { value: prepared.colors[2] }, uColor3: { value: prepared.colors[3] },
      uColor4: { value: prepared.colors[4] }, uColor5: { value: prepared.colors[5] },
      uColor6: { value: prepared.colors[6] }, uColor7: { value: prepared.colors[7] },
      uColorCount: { value: prepared.count }, uFlow: { value: flowVectors[flowDirection] },
      uSpeed: { value: speed }, uScale: { value: scale }, uTurbulence: { value: turbulence },
      uFluidity: { value: fluidity }, uRimWidth: { value: rimWidth }, uSharpness: { value: sharpness },
      uShimmer: { value: shimmer }, uGlow: { value: glow }, uOpacity: { value: opacity },
      uMouseEnabled: { value: mouseInteraction ? 1 : 0 }, uMouseStrength: { value: mouseStrength },
      uMouseRadius: { value: mouseRadius }
    };
    const program = new Program(gl, { vertex, fragment, uniforms });
    const geometry = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry, program });
    let frame = 0;
    let lastTime = 0;
    let isVisible = true;
    const mouseTarget = [0, 0];

    const resize = () => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    }, { threshold: 0.01 });
    visibilityObserver.observe(container);

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseTarget[0] = (event.clientX - rect.left) * renderer.dpr;
      mouseTarget[1] = (rect.height - (event.clientY - rect.top)) * renderer.dpr;
    };
    if (mouseInteraction) canvas.addEventListener("pointermove", onPointerMove);

    const render = (time: number) => {
      frame = window.requestAnimationFrame(render);
      if (paused || !isVisible || document.hidden) return;
      uniforms.iTime.value = time * 0.001;
      const delta = lastTime ? (time - lastTime) / 1000 : 0;
      lastTime = time;
      const factor = mouseDampening <= 0 ? 1 : 1 - Math.exp(-delta / mouseDampening);
      uniforms.iMouse.value[0] += (mouseTarget[0] - uniforms.iMouse.value[0]) * factor;
      uniforms.iMouse.value[1] += (mouseTarget[1] - uniforms.iMouse.value[1]) * factor;
      renderer.render({ scene: mesh });
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.remove();
      program.remove();
      geometry.remove();
    };
  }, [colors, dpr, flowDirection, fluidity, glow, mouseDampening, mouseInteraction, mouseRadius, mouseStrength, opacity, paused, rimWidth, scale, sharpness, shimmer, speed, turbulence]);

  return <div ref={containerRef} className={`${styles.container} ${className}`} aria-hidden="true" />;
}
