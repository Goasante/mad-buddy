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
          Ported from <code>Design Reference/MadBuddy_Proximity_Glow_Prototype.html</code>. At a
          glance, without reading the labels, the progression from Right Here to Across Town should
          be obvious.
        </p>
      </header>

      {SIZES.map((size) => (
        <section key={size} className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {size} — {PROXIMITY_GLOW_SIZES[size].avatarPx}px avatar
          </h2>

          <div className="flex flex-wrap items-start gap-4">
            {PROXIMITY_GLOW_LEVELS.map((level) => {
              const config = PROXIMITY_GLOW_CONFIG[level];
              return (
                <div key={level} className="flex w-40 flex-col items-center gap-2 text-center">
                  <ProximityGlowAvatar name="Saa Mensah" level={level} size={size} decorative />
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
