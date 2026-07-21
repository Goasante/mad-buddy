import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { BrandMark } from "./BrandMark";

// Faithful port of the web components/ui/sign-in-card-2.tsx so the app's auth
// screens match the web mobile view exactly (dark gradient, glow blobs, glassy
// card, brand mark).
export function SignInCard({
  title,
  description,
  children,
  footer
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07060b] px-4 py-16 text-white sm:px-6">
      <div
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(249,115,22,0.38)_0%,rgba(124,45,18,0.32)_38%,rgba(7,6,11,0.96)_78%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px"
        }}
        aria-hidden="true"
      />
      <motion.div
        className="absolute left-1/2 top-[-18rem] h-[36rem] w-[min(60rem,120vw)] -translate-x-1/2 rounded-full bg-orange-300/20 blur-[90px]"
        animate={reducedMotion ? undefined : { opacity: [0.45, 0.72, 0.45], scale: [0.98, 1.04, 0.98] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      />
      <motion.div
        className="absolute bottom-[-24rem] left-1/2 h-[38rem] w-[min(52rem,110vw)] -translate-x-1/2 rounded-full bg-amber-500/15 blur-[100px]"
        animate={reducedMotion ? undefined : { opacity: [0.35, 0.58, 0.35], scale: [1, 1.07, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      />

      <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 w-full max-w-sm"
        aria-labelledby="sign-in-title"
      >
        <div
          className="absolute -inset-px rounded-2xl bg-gradient-to-br from-white/20 via-white/[0.035] to-orange-300/15 opacity-80"
          aria-hidden="true"
        />
        <motion.div
          className="absolute -inset-3 -z-10 rounded-[1.75rem] bg-orange-400/10 blur-2xl"
          animate={reducedMotion ? undefined : { opacity: [0.35, 0.62, 0.35] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-black/55 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-7">
          <motion.span
            className="pointer-events-none absolute top-0 z-10 h-px w-1/3 bg-gradient-to-r from-transparent via-orange-200/80 to-transparent"
            initial={reducedMotion ? { left: "34%" } : { left: "-35%" }}
            animate={reducedMotion ? undefined : { left: ["-35%", "105%"] }}
            transition={{ duration: 3.4, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                "linear-gradient(135deg, white 0.5px, transparent 0.5px), linear-gradient(45deg, white 0.5px, transparent 0.5px)",
              backgroundSize: "28px 28px"
            }}
            aria-hidden="true"
          />
          <div className="relative">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <BrandMark className="h-8 w-8" />
              </div>
              <h1 id="sign-in-title" className="text-2xl font-semibold tracking-tight">
                {title}
              </h1>
              {description ? <p className="mt-2 text-sm leading-6 text-white/55">{description}</p> : null}
            </div>
            {children}
          </div>
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-white/55">{footer}</div> : null}
      </motion.section>
    </main>
  );
}
