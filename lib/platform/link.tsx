/**
 * Platform Link — web implementation.
 *
 * This is a VERBATIM re-export of next/link, deliberately. Two consequences
 * matter and both are intentional:
 *
 * 1. Web behaviour is byte-identical. A component that swaps
 *    `import Link from "next/link"` for `import { Link } from "@/lib/platform"`
 *    compiles to the same thing, so a migration sweep can be verified by
 *    diffing the build output (see docs in the shared-packages plan).
 *
 * 2. `typedRoutes: true` is on in next.config.ts, and 49 files already rely on
 *    `as Route` casts. Re-exporting the real component keeps that type
 *    checking exactly as it is. A hand-written wrapper typed `href: string`
 *    would silently disable typed routes across the whole app — a real loss of
 *    safety traded for nothing.
 *
 * The mobile build resolves `@/lib/platform` to `link.mobile.tsx` via a
 * resolve.alias in mobile/vite.config.ts; that file provides the same surface
 * without Next.
 */
export { default as Link } from "next/link";
export type { LinkProps } from "next/link";
