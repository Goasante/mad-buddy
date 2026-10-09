import { useId, type SVGProps } from "react";

export type NavigationGlyphName = "messages" | "muddies" | "home" | "linkr" | "meetups";

/** Solid vector icons matching the approved floating-nav mockup. */
export function NavigationGlyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: NavigationGlyphName }) {
  const linkMask = useId();
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {name === "messages" ? <path d="M16 2a14 14 0 0 0-12.2 20.9L2.5 29.5l6.7-1.4A14 14 0 1 0 16 2Z" /> : null}
      {name === "home" ? <path d="M3 13.4a2 2 0 0 1 .7-1.5L14.7 2.6a2 2 0 0 1 2.6 0l11 9.3a2 2 0 0 1 .7 1.5V28a2 2 0 0 1-2 2h-7V19h-8v11H5a2 2 0 0 1-2-2Z" /> : null}
      {name === "muddies" ? <>
        <circle cx="10" cy="9" r="5" /><circle cx="23" cy="9" r="5" />
        <path d="M1 28v-2a9 9 0 0 1 18 0v2H1ZM21 28v-2a11 11 0 0 0-4-8.5A9 9 0 0 1 32 26v2Z" />
      </> : null}
      {name === "linkr" ? <>
        <circle cx="9" cy="7" r="4.5" /><circle cx="23" cy="7" r="4.5" />
        <defs><mask id={linkMask} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          {/* Two interlocking diagonal links cut through the silhouettes.
              A true mask lets the glass show through in either theme. */}
          <g fill="none" stroke="black" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 22-1.5 1.5a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0" />
            <path d="m17 20 1.5-1.5a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" />
            <path d="m13 24 6-6" />
          </g>
        </mask></defs>
        <g mask={`url(#${linkMask})`}><circle cx="9" cy="23" r="9" /><circle cx="23" cy="23" r="9" /></g>
      </> : null}
      {name === "meetups" ? <>
        <path fillRule="evenodd" d="M11 1h2v2h6V1h2v2h2a2 2 0 0 1 2 2v11H7V5a2 2 0 0 1 2-2h2Zm-1 6v6h12V7Z" />
        <circle cx="13" cy="9" r="1" /><circle cx="17" cy="9" r="1" /><circle cx="21" cy="9" r="1" />
        <circle cx="13" cy="12" r="1" /><circle cx="17" cy="12" r="1" />
        <circle cx="7" cy="21" r="4" /><circle cx="25" cy="21" r="4" />
        <path d="M0 32v-1a7 7 0 0 1 14 0v1ZM18 32v-1a7 7 0 0 1 14 0v1Z" />
      </> : null}
    </svg>
  );
}
