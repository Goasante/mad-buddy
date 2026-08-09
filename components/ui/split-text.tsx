"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { SplitText as GSAPSplitText } from "gsap/SplitText";
import type { CSSProperties, ElementType } from "react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

gsap.registerPlugin(GSAPSplitText, useGSAP);

type SplitKind = "chars" | "words" | "lines" | "words, chars";
type SplitTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p";

type SplitTextProps = {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: SplitKind;
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  textAlign?: CSSProperties["textAlign"];
  tag?: SplitTag;
  onLetterAnimationComplete?: () => void;
};

const DEFAULT_FROM: gsap.TweenVars = { opacity: 0, y: 24 };
const DEFAULT_TO: gsap.TweenVars = { opacity: 1, y: 0 };

/**
 * Reusable React Bits SplitText treatment. It animates once per mount, so a
 * fresh Home route visit replays it without scroll listeners or global state.
 */
export function SplitText({
  text,
  className = "",
  delay = 45,
  duration = 0.55,
  ease = "power3.out",
  splitType = "chars",
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
  textAlign = "left",
  tag = "p",
  onLetterAnimationComplete
}: SplitTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const callbackRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const reducedMotion = useReducedMotion();
  const fromKey = JSON.stringify(from);
  const toKey = JSON.stringify(to);

  useEffect(() => {
    callbackRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useGSAP(() => {
    const element = ref.current;
    if (!element || !text || !fontsLoaded || reducedMotion) return;

    const split = new GSAPSplitText(element, {
      type: splitType,
      smartWrap: true,
      wordsClass: "split-word",
      linesClass: "split-line",
      charsClass: "split-char",
      reduceWhiteSpace: false
    });
    const targets = splitType.includes("chars")
      ? split.chars
      : splitType.includes("words")
        ? split.words
        : split.lines;
    const tween = gsap.fromTo(targets, { ...from }, {
      ...to,
      duration,
      ease,
      stagger: delay / 1_000,
      force3D: true,
      onComplete: () => callbackRef.current?.()
    });

    return () => {
      tween.kill();
      split.revert();
    };
  }, {
    scope: ref,
    dependencies: [text, delay, duration, ease, splitType, fromKey, toKey, fontsLoaded, reducedMotion]
  });

  const Tag = tag as ElementType;
  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        display: "inline-block",
        overflow: "hidden",
        textAlign,
        whiteSpace: "normal",
        overflowWrap: "break-word"
      }}
    >
      {text}
    </Tag>
  );
}
