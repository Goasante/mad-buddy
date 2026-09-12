/**
 * The platform adapter — the ONE module shared components may use to reach a
 * framework API.
 *
 * WHY THIS EXISTS. `components/**` is rendered by two apps: the Next.js web
 * app and the Capacitor/Vite SPA. 104 of 248 component files import next/link,
 * next/navigation or next/image, none of which exist outside Next — so those
 * files cannot be shared as-is. Importing from here instead of from "next/*"
 * makes a component portable without changing what it does.
 *
 * HOW IT RESOLVES. Web gets these files, which re-export the real Next
 * components verbatim — so web behaviour and types (including typedRoutes)
 * are unchanged, and a migration sweep can be verified by diffing build
 * output. The mobile build maps "@/lib/platform" to the .mobile
 * implementations via resolve.alias in mobile/vite.config.ts.
 *
 * WHAT BELONGS HERE. Only framework APIs that genuinely differ per platform.
 * This is not a general utility barrel: anything Next-agnostic should be
 * imported directly from where it lives, so this stays small and the cost of
 * each entry stays visible.
 */
export { Link, type LinkProps } from "./link";
export { Image, type ImageProps } from "./image";
export { useRouter, usePathname, useSearchParams } from "./router";
export { useRevalidate } from "./revalidate";
