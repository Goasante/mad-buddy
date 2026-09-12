/**
 * Platform router — web implementation.
 *
 * Verbatim re-exports, for the same reason as link.tsx: web behaviour must be
 * byte-identical so a migration sweep can be verified by diffing build output,
 * and next/navigation's own types (including typedRoutes-aware push/replace)
 * are preserved exactly.
 *
 * The mobile build resolves `@/lib/platform` to the .mobile files via a
 * resolve.alias in mobile/vite.config.ts.
 */
export { useRouter, usePathname, useSearchParams } from "next/navigation";
