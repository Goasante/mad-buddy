import { useState } from "react";
import { CreditCard, Eye, LifeBuoy, Rocket, Search, Settings, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Screen } from "../components/AppShell";

const popularTopics = [
  { title: "Getting Started", description: "Learn the basics and set up your profile.", icon: Rocket },
  { title: "Glow & Visibility", description: "Understand how Glow and visibility work.", icon: Eye },
  { title: "Meet & Plans", description: "How to create, join, and manage plans.", icon: LifeBuoy },
  { title: "Safety & Privacy", description: "Keep your account and data safe.", icon: Shield },
  { title: "Billing & Premium", description: "Manage payments, plans, and refunds.", icon: CreditCard },
  { title: "Account & Settings", description: "Update your profile and preferences.", icon: Settings }
];

export function HelpScreen() {
  const [query, setQuery] = useState("");
  const topics = popularTopics.filter((topic) => topic.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Screen title="How can we help you?">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help articles..." className="pl-9" />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Popular topics</h2>
        <div className="space-y-3">
          {topics.map((topic) => (
            <div key={topic.title} className="rounded-2xl border border-border/70 bg-card/50 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <topic.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-base font-semibold">{topic.title}</h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{topic.description}</p>
            </div>
          ))}
          {topics.length === 0 ? (
            <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">No topics match that search.</p>
          ) : null}
        </div>
      </section>
    </Screen>
  );
}
