import { cn } from "@/lib/utils";
import { resolvePlanCover, type PlanCoverMotif, type ResolvedPlanCover } from "@/lib/plans/plan-covers";
import type { PlanCategory } from "@/lib/supabase/database.types";

/**
 * The canonical plan cover renderer.
 *
 * Every plan surface uses this — it takes a plan's cover fields, runs the
 * shared resolver, and draws whichever of the three tiers applies. A surface
 * never picks an image or a colour itself.
 *
 * Canonical covers are drawn as SVG rather than loaded as files: crisp at any
 * size, no network cost, no layout shift, and a new cover type is a registry
 * entry rather than an asset drop.
 */
export function PlanCover({
  category,
  coverImageUrl,
  className,
  rounded = "rounded-xl",
  /** Adds the bottom scrim used when text is overlaid on the cover. */
  scrim = false
}: {
  category?: PlanCategory | string | null;
  coverImageUrl?: string | null;
  className?: string;
  rounded?: string;
  scrim?: boolean;
}) {
  const cover = resolvePlanCover({ category, coverImageUrl });

  return (
    <span
      role="img"
      aria-label={cover.label}
      className={cn("relative block overflow-hidden bg-secondary", rounded, className)}
      data-cover-source={cover.source}
    >
      {cover.source === "upload" ? (
        // object-cover with a centred focal point: the crop keeps the middle
        // of the image, which is where a plan photo's subject sits.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.imageUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <CoverArt cover={cover} />
      )}

      {/* Bottom gradient, so overlaid text stays readable on any cover. Only
          rendered when the surface actually overlays text. */}
      {scrim ? (
        <span
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

/** The gradient wash plus its geometric motif. */
function CoverArt({ cover }: { cover: Extract<ResolvedPlanCover, { art: NonNullable<unknown> }> }) {
  const { from, to, motif } = cover.art;
  return (
    <span
      className="absolute inset-0"
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 120 120"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        fill="none"
      >
        <Motif motif={motif} />
      </svg>
    </span>
  );
}

/**
 * The motifs. Deliberately simple geometry at low opacity — these read as
 * branded texture behind a title, not as illustrations competing with it.
 */
function Motif({ motif }: { motif: PlanCoverMotif }) {
  const line = { stroke: "rgba(255,255,255,0.5)", strokeWidth: 3, strokeLinecap: "round" as const };
  const soft = "rgba(255,255,255,0.16)";

  switch (motif) {
    case "waves":
      return (
        <>
          <circle cx="92" cy="26" r="14" fill={soft} />
          <path d="M-5 78q15-10 30 0t30 0 30 0 30 0" {...line} />
          <path d="M-5 94q15-10 30 0t30 0 30 0 30 0" {...line} strokeWidth={2.5} />
        </>
      );
    case "plate":
      return (
        <>
          <circle cx="60" cy="60" r="30" fill={soft} />
          <circle cx="60" cy="60" r="19" stroke="rgba(255,255,255,0.45)" strokeWidth={3} />
          <path d="M26 42v36M94 42v36" {...line} />
        </>
      );
    case "cup":
      return (
        <>
          <path d="M38 48h38v22a19 19 0 0 1-19 19 19 19 0 0 1-19-19z" fill={soft} />
          <path d="M76 54h9a9 9 0 0 1 0 18h-9" {...line} />
          <path d="M48 28v10M60 24v14M72 28v10" {...line} strokeWidth={2.5} />
        </>
      );
    case "book":
      return (
        <>
          <path d="M26 34h30v56H26zM64 34h30v56H64z" fill={soft} />
          <path d="M60 34v56" {...line} />
          <path d="M34 50h14M34 62h14M72 50h14M72 62h14" {...line} strokeWidth={2.5} />
        </>
      );
    case "screen":
      return (
        <>
          <rect x="24" y="34" width="72" height="46" rx="6" fill={soft} />
          <path d="m52 48 22 13-22 13z" fill="rgba(255,255,255,0.5)" />
          <path d="M46 92h28" {...line} />
        </>
      );
    case "pitch":
      return (
        <>
          <circle cx="60" cy="60" r="24" fill={soft} />
          <circle cx="60" cy="60" r="24" stroke="rgba(255,255,255,0.45)" strokeWidth={3} />
          <path d="M60 12v96M12 60h96" {...line} strokeWidth={2.5} />
        </>
      );
    case "controller":
      return (
        <>
          <rect x="20" y="44" width="80" height="36" rx="18" fill={soft} />
          <path d="M40 56v12M34 62h12" {...line} />
          <circle cx="80" cy="58" r="4.5" fill="rgba(255,255,255,0.55)" />
          <circle cx="88" cy="68" r="4.5" fill="rgba(255,255,255,0.55)" />
        </>
      );
    case "stage":
      // A microphone, not a figure: the earlier silhouette read as a stick
      // person rather than a performance.
      return (
        <>
          <rect x="50" y="24" width="20" height="38" rx="10" fill={soft} />
          <path d="M38 54a22 22 0 0 0 44 0" {...line} />
          <path d="M60 76v18M46 94h28" {...line} />
          <path d="M24 34l8 6M96 34l-8 6" {...line} strokeWidth={2.5} />
        </>
      );
    case "confetti":
      // A layered cake: unmistakably a birthday at 44px, where the old
      // popper cone read as a play triangle.
      return (
        <>
          <path d="M30 62h60v30H30z" fill={soft} />
          <path d="M38 62V50h44v12" {...line} strokeWidth={2.5} />
          <path d="M48 44v-8M60 40v-12M72 44v-8" {...line} />
          <circle cx="48" cy="32" r="3.5" fill="rgba(255,255,255,0.55)" />
          <circle cx="60" cy="24" r="3.5" fill="rgba(255,255,255,0.55)" />
          <circle cx="72" cy="32" r="3.5" fill="rgba(255,255,255,0.55)" />
        </>
      );
    case "compass":
      return (
        <>
          <circle cx="60" cy="60" r="30" fill={soft} />
          <circle cx="60" cy="60" r="30" stroke="rgba(255,255,255,0.45)" strokeWidth={3} />
          <path d="m72 48-8 20-20 8 8-20z" fill="rgba(255,255,255,0.55)" />
        </>
      );
    case "pulse":
      return (
        <>
          <path d="M8 62h24l10-22 14 44 12-30 10 8h34" {...line} strokeWidth={4} />
          <circle cx="96" cy="34" r="10" fill={soft} />
        </>
      );
    case "sparkle":
      return (
        <>
          <path d="m60 26 7 21 21 7-21 7-7 21-7-21-21-7 21-7z" fill={soft} />
          <path d="m96 76 3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="rgba(255,255,255,0.35)" />
          <path d="m24 30 2.5 7.5L34 40l-7.5 2.5L24 50l-2.5-7.5L14 40l7.5-2.5z" fill="rgba(255,255,255,0.3)" />
        </>
      );
    case "basket":
      return (
        <>
          <path d="M28 54h64l-7 34H35z" fill={soft} />
          <path d="M44 54a16 16 0 0 1 32 0" {...line} />
          <path d="M44 62l4 22M60 62v22M76 62l-4 22" {...line} strokeWidth={2.5} />
        </>
      );
    case "peaks":
      return (
        <>
          <path d="M4 92 40 40l22 30 14-18 36 40z" fill={soft} />
          <path d="M40 40 26 60h28z" fill="rgba(255,255,255,0.4)" />
          <circle cx="92" cy="28" r="9" fill="rgba(255,255,255,0.35)" />
        </>
      );
    case "route":
      return (
        <>
          <path d="M22 96c0-30 76-42 76-72" {...line} strokeWidth={4} strokeDasharray="10 10" />
          <circle cx="22" cy="96" r="7" fill="rgba(255,255,255,0.5)" />
          <circle cx="98" cy="24" r="7" fill="rgba(255,255,255,0.5)" />
        </>
      );
    case "mark":
    default:
      // The branded fallback: Mad Buddy's own concentric-proximity motif, the
      // same idea the empty states use, at rest.
      return (
        <>
          <circle cx="60" cy="60" r="34" stroke="rgba(255,255,255,0.28)" strokeWidth={3} />
          <circle cx="60" cy="60" r="22" stroke="rgba(255,255,255,0.36)" strokeWidth={3} />
          <circle cx="60" cy="60" r="10" fill="rgba(255,255,255,0.5)" />
        </>
      );
  }
}
