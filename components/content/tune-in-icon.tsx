/**
 * The ONE canonical Tune In icon.
 *
 * A broadcast/signal motif: a solid centre with outward arcs, read as "I'm tuned
 * into this person's public Moments". Used for the Tune In button, the Tuned In
 * state, the creator hub, My Tuned In, the new-content indicator and creator
 * analytics, so the concept has a single visual identity.
 *
 * Deliberately NOT a star, heart, bell or person-with-a-plus: each of those
 * would say the wrong thing. A star reads as a favourite, a heart as a reaction
 * (which Tune In is explicitly independent of), a bell as notifications (Tune In
 * never notifies anyone), and a person-follow glyph as a follower graph, which
 * this product does not have.
 *
 * Drawn as inline SVG with `currentColor` so it inherits colour and sizing like a
 * lucide icon, matching the surrounding chrome without adding a dependency.
 */
export function TuneInIcon({
  className,
  size,
  /** Renders only the outward arcs, for the compact new-content indicator. */
  wavesOnly = false,
  title
}: {
  className?: string;
  size?: number;
  wavesOnly?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {/* The source: a filled centre point. */}
      {wavesOnly ? null : <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />}
      {/* Inner arcs both sides, then outer arcs: a signal radiating outward. */}
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8" />
      <path d="M15.9 8.1a5.5 5.5 0 0 1 0 7.8" />
      <path d="M5.3 5.3a9.5 9.5 0 0 0 0 13.4" opacity="0.55" />
      <path d="M18.7 5.3a9.5 9.5 0 0 1 0 13.4" opacity="0.55" />
    </svg>
  );
}
