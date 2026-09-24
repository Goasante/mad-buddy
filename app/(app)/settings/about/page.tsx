import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HeartHandshake, ShieldCheck, Users } from "lucide-react";

import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "About Mad Buddy" };

const features = [
  { icon: Users, title: "Stay close to your Muddies", description: "See broad proximity signals for mutually approved friends, always within each person's visibility choices." },
  { icon: HeartHandshake, title: "Make plans together", description: "Discover people through Linkr when you opt in, share what you are UpFor, and turn conversations into plans and events." },
  { icon: ShieldCheck, title: "Keep control", description: "Ghost Mode, privacy settings, blocking and Safe Arrival help you choose how you connect. Your exact location is not shown to other members." }
] as const;

export default function AboutAppPage() {
  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader title="About Mad Buddy" description="When your friends are close, they glow." />

      <p className="text-sm leading-7 text-muted-foreground">
        Mad Buddy helps you connect with your Muddies in real life. Proximity is approximate, discovery is your choice, and the app is built to turn a hello into time together.
      </p>

      <div className="grid gap-3">
        {features.map((feature) => (
          <Card key={feature.title} className="flex gap-3 p-4">
            <feature.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{feature.description}</p>
            </div>
          </Card>
        ))}
      </div>

      <nav className="grid gap-2 sm:grid-cols-2" aria-label="Explore Mad Buddy">
        {([
          { href: "/settings/privacy", label: "Privacy settings" },
          { href: "/safety-center", label: "Safety Center" },
          { href: "/help", label: "Help & Support" },
          { href: "/settings", label: "Back to Settings" }
        ] as const).map((item) => (
          <Link key={item.href} href={item.href} className="focus-ring flex min-h-11 items-center justify-between rounded-xl border border-border/70 px-4 text-sm font-medium hover:bg-secondary/40">
            {item.label}
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
