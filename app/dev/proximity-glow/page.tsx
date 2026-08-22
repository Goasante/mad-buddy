import { notFound } from "next/navigation";
import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import {
  PROXIMITY_GLOW_CONFIG,
  PROXIMITY_GLOW_LEVELS,
  PROXIMITY_GLOW_SIZES,
  referenceGeometry,
  type ProximityGlowSize
} from "@/lib/proximity/glow-config";

/**
 * The Proximity Glow comparison harness.
 *
 * DEVELOPMENT ONLY. This is the acceptance test from the brief made runnable:
 * the same avatar rendered six times side by side, so the progression can be
 * judged at a glance against the approved prototype rather than asserted from
 * six CSS class names existing.
 *
 * It 404s outside development. It renders no real person, reads no location,
 * and calls no API -- every state here is a hard-coded level, so the page
 * cannot leak a real proximity relationship even if it were somehow reachable.
 */

export const dynamic = "force-static";

const SIZES = Object.keys(PROXIMITY_GLOW_SIZES) as ProximityGlowSize[];

export default function ProximityGlowHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Proximity Glow — six states</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ported from <code>design-reference/proximity-glow-v1.html</code>. At a
          glance, without reading the labels, the progression from Right Here to Across Town should
          be obvious.
        </p>
      </header>

      {SIZES.map((size) => (
        <section key={size} className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {size} — {PROXIMITY_GLOW_SIZES[size].avatarPx}px avatar
          </h2>

          {/* A 6-column grid, not a wrapping flex row. The whole point of this
              section is seeing all six states at once; wrapping the last one
              onto its own line breaks the comparison the page exists for.
              Six hero Glows are ~1200px, so on a narrow screen the ROW scrolls
              inside its own container rather than pushing the page sideways --
              a body that scrolls horizontally would shift every section. */}
          <div className="-mx-6 overflow-x-auto px-6">
            <div className="grid w-max grid-cols-6 items-start gap-2">
            {PROXIMITY_GLOW_LEVELS.map((level) => {
              const config = PROXIMITY_GLOW_CONFIG[level];
              return (
                <div key={level} className="flex w-56 flex-col items-center gap-2 text-center">
                  <ProximityGlowAvatar
                    name="Saa Mensah"
                    level={level}
                    size={size}
                    decorative
                    /* Harness only: reserve the full bloom so each state gets
                       its own measurable column. Product rows let it overflow. */
                    className="proximity-glow-reserve-bloom"
                  />
                  <span className="text-sm font-semibold">{config.label}</span>
                  <span className="text-xs text-muted-foreground">{config.description}</span>
                  {/* Engineering readout, harness only. The production UI shows
                      the state name and nothing else -- never these numbers,
                      and never a distance. */}
                  <span className="font-mono text-[10px] leading-relaxed text-muted-foreground/70">
                    ring {config.ring} · outer {config.outer} · blur {config.blur}
                    <br />
                    strength {config.strength} · pulse {config.pulseSeconds}s
                  </span>
                </div>
              );
            })}
            </div>
          </div>
        </section>
      ))}

      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Reference geometry (1:1 with the prototype)
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The approved values themselves, unscaled — open the prototype beside this row and the
          numbers should be identical, not merely close.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-semibold">State</th>
                <th className="py-2 pr-4 font-semibold">ring</th>
                <th className="py-2 pr-4 font-semibold">outer</th>
                <th className="py-2 pr-4 font-semibold">blur</th>
                <th className="py-2 pr-4 font-semibold">strength</th>
                <th className="py-2 pr-4 font-semibold">pulse</th>
              </tr>
            </thead>
            <tbody>
              {PROXIMITY_GLOW_LEVELS.map((level) => {
                const config = PROXIMITY_GLOW_CONFIG[level];
                const geometry = referenceGeometry(level);
                return (
                  <tr key={level} className="border-t border-border/60">
                    <td className="py-2 pr-4">{config.label}</td>
                    <td className="py-2 pr-4">{geometry.ring}</td>
                    <td className="py-2 pr-4">{geometry.outer}</td>
                    <td className="py-2 pr-4">{geometry.blur}</td>
                    <td className="py-2 pr-4">{config.strength}</td>
                    <td className="py-2 pr-4">{config.pulseSeconds}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Performance grid — 12 simultaneous Glows
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Two of every state, at the size a Muddies list actually uses. Watch for jank, layout
          movement, or neighbouring auras colliding. Each Glow reserves its own box, so the row
          spacing should stay even regardless of state.
        </p>
        <div className="flex flex-wrap gap-3">
          {[...PROXIMITY_GLOW_LEVELS, ...PROXIMITY_GLOW_LEVELS].map((level, index) => (
            <div key={`${level}-${index}`} className="flex flex-col items-center gap-1">
              <ProximityGlowAvatar name={`Muddy ${index + 1}`} level={level} size="md" decorative />
              <span className="text-[10px] text-muted-foreground">
                {PROXIMITY_GLOW_CONFIG[level].label}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Side by side with the approved prototype
        </h2>
        {/* A LINK, NOT AN IFRAME. The app's CSP sets `frame-src` to Turnstile
            only and `frame-ancestors 'none'`, so embedding the reference would
            be blocked — and loosening CSP so a design harness can frame itself
            is a bad trade for a local convenience. Opening it in a second
            window is also the better comparison: two full-size views side by
            side beat one squeezed into a scrolling box. */}
        <p className="max-w-2xl text-sm text-muted-foreground">
          Open the reference in a second window and put it beside this one. Drag its slider through
          the six states and compare against the rows above — same warmth, same energy progression,
          same layer behaviour.
        </p>
        <a
          href="/dev/proximity-glow/reference"
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex w-fit items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Open approved prototype ↗
        </a>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          No proximity signal
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Absent is not &ldquo;far&rdquo;. An avatar with no band renders bare, so ordinary chat,
          group and Plan avatars never wear a Glow.
        </p>
        <ProximityGlowAvatar name="Saa Mensah" level={null} size="lg" decorative />
      </section>
    </main>
  );
}
