import Link from "next/link";
import { ArrowRight, Heart, MapPinOff, Sparkles, Users } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

const values = [
  { title: "Our Mission", description: "Bring friends together in the real world.", icon: Sparkles },
  { title: "Privacy First", description: "Your privacy is our highest priority.", icon: MapPinOff },
  { title: "People Focused", description: "Built for friends, not followers.", icon: Users },
  { title: "Real Impact", description: "More real moments, less screen time.", icon: Heart }
];

export function AboutPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-3 font-semibold">
            <BrandMark className="h-9 w-9" priority />
            Mad Buddy
          </Link>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Our story</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Built for real friends and <span className="text-primary">real life.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
          Mad Buddy was born out of a simple belief: meaningful connections happen when people show
          up for each other in real life. We built Mad Buddy to help you discover friends nearby,
          make plans that matter, and turn digital connection into real-world moments.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {values.map((value) => (
            <div key={value.title} className="rounded-2xl border border-border/80 bg-card/50 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <value.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-base font-semibold">{value.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{value.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-border/70 bg-card/50 p-6 text-center">
          <p className="text-lg font-semibold">Made with ❤️ for real life.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;re a small team with a big mission: help people live more connected, more intentional lives.
          </p>
          <Button type="button" className="mt-5" asChild>
            <Link href="/signup">
              Join Our Journey
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
