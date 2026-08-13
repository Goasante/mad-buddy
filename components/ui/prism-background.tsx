"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative animated prism, rendered behind card content.
 *
 * Ported from the React Bits Prism component. Deliberate changes from the
 * original, all for running inside a real product surface rather than a demo
 * page:
 *
 *   - PURELY DECORATIVE. `pointer-events: none` on the container, so the
 *     canvas can never intercept a tap, link, button or long press. It has no
 *     accessible name and is hidden from assistive technology.
 *   - FAILURE IS NEVER FATAL. The original constructs the renderer
 *     unguarded; a WebGL context that is refused (blocklisted driver, too many
 *     live contexts, memory pressure) would throw inside an effect and take
 *     Home down with it. Everything here is wrapped, and a failure simply
 *     leaves the card's own background showing.
 *   - `ogl` is imported dynamically, so ~50KB of WebGL never enters the
 *     initial bundle for a card that may not even render.
 *   - The IntersectionObserver is held in closure scope rather than as an
 *     expando property on the container element, where it could survive a
 *     missed cleanup and keep observing a detached node.
 *   - Listener cleanup is unconditional rather than gated on the animation
 *     type it was registered under.
 *
 * REDUCED MOTION IS HANDLED BY THE CALLER, not here: a genuinely static
 * result means rendering no canvas at all, which is the caller's decision to
 * make about its own layout.
 */

export type PrismBackgroundProps = {
  /** Apex height of the prism, in world units. */
  height?: number;
  /** Total base width across X/Z, in world units. */
  baseWidth?: number;
  animationType?: "rotate" | "hover" | "3drotate";
  /** Glow/bleed intensity multiplier. */
  glow?: number;
  /** Film-grain amount. 0 disables it entirely. */
  noise?: number;
  /** Screen-space scale. Larger reads softer, with less visible structure. */
  scale?: number;
  /** Hue rotation in radians. */
  hueShift?: number;
  /** Frequency of the internal colour bands. */
  colorFrequency?: number;
  /** Extra bloom on top of glow. */
  bloom?: number;
  /** Global time multiplier. 0 freezes. */
  timeScale?: number;
  /**
   * Pixel offset of the prism within the canvas (x right, y down).
   *
   * Used to push the brightest part of the light away from the text column,
   * so a bright pass never sweeps under the copy.
   */
  offsetX?: number;
  offsetY?: number;
  /** Pause rendering while offscreen. */
  suspendWhenOffscreen?: boolean;
  className?: string;
};

export function PrismBackground({
  height = 3.5,
  baseWidth = 5.5,
  animationType = "rotate",
  glow = 1,
  noise = 0.5,
  scale = 3.6,
  hueShift = 0,
  colorFrequency = 1,
  bloom = 1,
  timeScale = 0.5,
  offsetX = 0,
  offsetY = 0,
  suspendWhenOffscreen = true,
  className
}: PrismBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cancelled by cleanup if the component unmounts before ogl resolves,
    // so a late import can never append a canvas to a detached node.
    let disposed = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      let Renderer: typeof import("ogl").Renderer;
      let Triangle: typeof import("ogl").Triangle;
      let Program: typeof import("ogl").Program;
      let Mesh: typeof import("ogl").Mesh;
      try {
        ({ Renderer, Triangle, Program, Mesh } = await import("ogl"));
      } catch {
        // The chunk failed to load. The card keeps its own background.
        return;
      }
      if (disposed || !containerRef.current) return;

      const H = Math.max(0.001, height);
      const BW = Math.max(0.001, baseWidth);
      const BASE_HALF = BW * 0.5;
      const GLOW = Math.max(0, glow);
      const NOISE = Math.max(0, noise);
      const SCALE = Math.max(0.001, scale);
      const CFREQ = Math.max(0, colorFrequency || 1);
      const BLOOM = Math.max(0, bloom || 1);
      const TS = Math.max(0, timeScale);

      // Capped at 2: a 3x display would triple the fragment cost of a purely
      // decorative layer for no perceptible gain.
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      let renderer: InstanceType<typeof Renderer>;
      try {
        renderer = new Renderer({ dpr, alpha: true, antialias: false });
      } catch {
        // No WebGL context available. Decoration is skipped; nothing breaks.
        return;
      }

      const gl = renderer.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);

      Object.assign(gl.canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block"
      });
      container.appendChild(gl.canvas);

      const vertex = /* glsl */ `
        attribute vec2 position;
        void main() { gl_Position = vec4(position, 0.0, 1.0); }
      `;

      const fragment = /* glsl */ `
        precision highp float;
        uniform vec2  iResolution;
        uniform float iTime;
        uniform vec2  uOffsetPx;
        uniform float uGlow;
        uniform float uNoise;
        uniform float uSaturation;
        uniform float uHueShift;
        uniform float uColorFreq;
        uniform float uBloom;
        uniform float uCenterShift;
        uniform float uInvBaseHalf;
        uniform float uInvHeight;
        uniform float uMinAxis;
        uniform float uPxScale;
        uniform float uTimeScale;
        uniform mat3  uRot;
        uniform int   uUseBaseWobble;

        vec4 tanh4(vec4 x){ vec4 e2x = exp(2.0*x); return (e2x - 1.0) / (e2x + 1.0); }
        float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123); }

        float sdOctaAnisoInv(vec3 p){
          vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
          float m = q.x + q.y + q.z - 1.0;
          return m * uMinAxis * 0.5773502691896258;
        }
        float sdPyramidUpInv(vec3 p){ return max(sdOctaAnisoInv(p), -p.y); }

        mat3 hueRotation(float a){
          float c = cos(a), s = sin(a);
          mat3 W = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114);
          mat3 U = mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.300,-0.588,0.886);
          mat3 V = mat3(0.168,-0.331,0.500, 0.328,0.035,-0.500, -0.497,0.296,0.201);
          return W + U * c + V * s;
        }

        void main(){
          vec2 f = (gl_FragCoord.xy - 0.5 * iResolution.xy - uOffsetPx) * uPxScale;
          float z = 5.0;
          float d = 0.0;
          vec3 p;
          vec4 o = vec4(0.0);

          mat2 wob = mat2(1.0);
          if (uUseBaseWobble == 1) {
            float t = iTime * uTimeScale;
            float c0 = cos(t + 0.0);
            float c1 = cos(t + 33.0);
            float c2 = cos(t + 11.0);
            wob = mat2(c0, c1, c2, c0);
          }

          const int STEPS = 100;
          for (int i = 0; i < STEPS; i++) {
            p = vec3(f, z);
            p.xz = p.xz * wob;
            p = uRot * p;
            vec3 q = p;
            q.y += uCenterShift;
            d = 0.1 + 0.2 * abs(sdPyramidUpInv(q));
            z -= d;
            o += (sin((p.y + z) * uColorFreq + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0) / d;
          }

          o = tanh4(o * o * (uGlow * uBloom) / 1e5);
          vec3 col = o.rgb;
          if (uNoise > 0.0001) {
            col += (rand(gl_FragCoord.xy + vec2(iTime)) - 0.5) * uNoise;
          }
          col = clamp(col, 0.0, 1.0);
          float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);
          if (abs(uHueShift) > 0.0001) col = clamp(hueRotation(uHueShift) * col, 0.0, 1.0);
          gl_FragColor = vec4(col, o.a);
        }
      `;

      const geometry = new Triangle(gl);
      const iResBuf = new Float32Array(2);
      const offsetPxBuf = new Float32Array(2);
      const rotBuf = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

      const program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          iResolution: { value: iResBuf },
          iTime: { value: 0 },
          uOffsetPx: { value: offsetPxBuf },
          uRot: { value: rotBuf },
          uUseBaseWobble: { value: animationType === "rotate" ? 1 : 0 },
          uGlow: { value: GLOW },
          uNoise: { value: NOISE },
          uSaturation: { value: 1.5 },
          uHueShift: { value: hueShift || 0 },
          uColorFreq: { value: CFREQ },
          uBloom: { value: BLOOM },
          uCenterShift: { value: H * 0.25 },
          uInvBaseHalf: { value: 1 / BASE_HALF },
          uInvHeight: { value: 1 / H },
          uMinAxis: { value: Math.min(BASE_HALF, H) },
          uPxScale: { value: 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE) },
          uTimeScale: { value: TS }
        }
      });
      const mesh = new Mesh(gl, { geometry, program });

      const resize = () => {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h);
        iResBuf[0] = gl.drawingBufferWidth;
        iResBuf[1] = gl.drawingBufferHeight;
        offsetPxBuf[0] = offsetX * dpr;
        offsetPxBuf[1] = offsetY * dpr;
        program.uniforms.uPxScale.value = 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE);
      };
      const ro = new ResizeObserver(resize);
      ro.observe(container);
      resize();

      let raf = 0;
      const t0 = performance.now();

      const render = (t: number) => {
        program.uniforms.iTime.value = (t - t0) * 0.001;
        renderer.render({ scene: mesh });
        // A frozen prism still needs one frame drawn, but not a running loop.
        raf = TS < 1e-6 ? 0 : requestAnimationFrame(render);
      };
      const startRAF = () => {
        if (!raf) raf = requestAnimationFrame(render);
      };
      const stopRAF = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      };

      let io: IntersectionObserver | null = null;
      if (suspendWhenOffscreen) {
        io = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) startRAF();
          else stopRAF();
        });
        io.observe(container);
      }
      startRAF();

      teardown = () => {
        stopRAF();
        ro.disconnect();
        io?.disconnect();
        if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
        // Frees the GPU context rather than waiting for GC, which matters on
        // mobile where the live-context budget is small.
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
      if (disposed) teardown();
    })();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [
    height,
    baseWidth,
    animationType,
    glow,
    noise,
    scale,
    hueShift,
    colorFrequency,
    bloom,
    timeScale,
    offsetX,
    offsetY,
    suspendWhenOffscreen
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    />
  );
}
