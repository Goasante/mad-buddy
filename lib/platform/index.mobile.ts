/**
 * The platform adapter — mobile resolution target.
 *
 * mobile/vite.config.ts aliases "@/lib/platform" to this file, so a shared
 * component importing { Link, Image, useRouter } gets the react-router and
 * plain-<img> implementations instead of the Next ones, with no change to the
 * component's own source.
 *
 * The exported surface must stay identical to index.ts, or a component that
 * compiles on web will fail to build for mobile. The mobile CI job added in
 * PR #84 is what enforces that.
 */
export { Link, type LinkProps } from "./link.mobile";
export { Image, type ImageProps } from "./image.mobile";
export { useRouter, usePathname, useSearchParams, useRevalidate } from "./router.mobile";
export { toMobilePath } from "./routes.mobile";
