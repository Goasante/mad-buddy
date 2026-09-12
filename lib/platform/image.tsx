/**
 * Platform Image — web implementation.
 *
 * Verbatim re-export of next/image, so web keeps the optimizer, the
 * responsive srcset, and byte-identical output. The mobile build resolves
 * `@/lib/platform` to image.mobile.tsx, which renders a plain <img> — correct
 * there, because a bundled webview has no image optimization endpoint to call.
 */
export { default as Image } from "next/image";
export type { ImageProps } from "next/image";
