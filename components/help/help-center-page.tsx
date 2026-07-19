"use client";

import {
  CreditCard,
  Eye,
  LifeBuoy,
  MessageSquare,
  Rocket,
  Search,
  Settings,
  Shield
} from "lucide-react";
import { useState } from "react";
import { useTransition } from "react";
import { submitSupportRequestAction } from "@/app/(app)/help-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/auth/form-field";

const popularTopics = [
  { title: "Getting Started", description: "Learn the basics and set up your profile.", icon: Rocket },
  { title: "Glow & Visibility", description: "Understand how Glow and visibility work.", icon: Eye },
  { title: "Meet & Plans", description: "How to create, join, and manage plans.", icon: LifeBuoy },
  { title: "Safety & Privacy", description: "Keep your account and data safe.", icon: Shield },
  { title: "Billing & Premium", description: "Manage payments, plans, and refunds.", icon: CreditCard },
  { title: "Account & Settings", description: "Update your profile and preferences.", icon: Settings }
];

export function HelpCenterPage() {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mx-auto max-w-[900px] space-y-8 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">How can we help you?</h1>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help articles..." className="pl-9" />
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Popular topics</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {popularTopics
            .filter((topic) => topic.title.toLowerCase().includes(query.trim().toLowerCase()))
            .map((topic) => (
              <div key={topic.title} className="rounded-xl border border-border/70 bg-card/50 p-4">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <topic.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{topic.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{topic.description}</p>
              </div>
            ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/50 p-5">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Send us a message</h2>
        </div>

        {sent ? (
          <p className="text-sm text-muted-foreground">Thanks, our team will get back to you soon.</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField htmlFor="help-name" label="Full name">
                <Input id="help-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" />
              </FormField>
              <FormField htmlFor="help-email" label="Email">
                <Input id="help-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email" />
              </FormField>
            </div>
            <FormField htmlFor="help-message" label="Message">
              <Textarea id="help-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="How can we help?" />
            </FormField>
            <Button
              type="button"
              disabled={isPending || !name.trim() || !email.trim() || message.trim().length < 3}
              onClick={() => startTransition(async () => {
                setFeedback("");
                const result = await submitSupportRequestAction({ fullName: name, email, message });
                if (result.ok) setSent(true);
                else setFeedback(result.message);
              })}
            >
              {isPending ? "Sending..." : "Send message"}
            </Button>
            {feedback ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{feedback}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
