import Link from "next/link";
import { Ban, Eye, MapPin, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const safetyTools = [
  { title: "Safe Arrival", description: "Share your trip and let friends know when you arrive safely.", icon: MapPin, comingSoon: true },
  { title: "Live Location", description: "Temporarily share a more precise location with chosen people.", icon: MapPin, comingSoon: true },
  { title: "Block & Report", description: "Easily block or report anyone who breaks the rules.", icon: Ban, href: "/friends" as const },
  { title: "Muddy Score", description: "Real people, real profiles, real accountability.", icon: ShieldCheck, comingSoon: true }
];

const safetyTips = [
  { title: "Meet in public places", description: "Choose safe meeting spots, especially for new connections.", icon: Users },
  { title: "Trust your instincts", description: "If something feels off, it probably is, leave anytime.", icon: Eye },
  { title: "Stay connected", description: "Keep your people in the loop when you're out and about.", icon: MessageCircle }
];

export function SafetyCenterPage() {
  return (
    <div className="mx-auto max-w-[900px] space-y-8 pt-6">
      <div className="rounded-2xl border border-primary/30 bg-primary/10 p-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/15 text-primary">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Your safety is our priority.</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Tips, tools, and resources to help you stay safe while you connect and meet.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Safety tools</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {safetyTools.map((tool) =>
            tool.href ? (
              <Link
                key={tool.title}
                href={tool.href}
                className="focus-ring safe-motion rounded-xl border border-border/70 bg-card/50 p-4 hover:bg-secondary/40"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <tool.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{tool.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{tool.description}</p>
              </Link>
            ) : (
              <div key={tool.title} className="rounded-xl border border-dashed border-border/70 bg-card/30 p-4 opacity-80">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <tool.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{tool.title}</h3>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Coming soon</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{tool.description}</p>
              </div>
            )
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Safety tips</h2>
        <div className="space-y-2">
          {safetyTips.map((tip) => (
            <div key={tip.title} className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
              <tip.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">{tip.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{tip.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-xl border border-border/70 bg-card/50 p-4 text-center">
        <p className="text-sm font-medium">Need help or want to report something?</p>
        <p className="mt-1 text-xs text-muted-foreground">Our support team is here for you.</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" asChild>
          <Link href="/help">Contact Support</Link>
        </Button>
      </div>
    </div>
  );
}
