"use client";

import {
  ChevronRight,
  CreditCard,
  Eye,
  Flag,
  MessageSquare,
  Rocket,
  Search,
  Send,
  Settings,
  Shield,
  UsersRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTransition } from "react";
import { replyToSupportThreadAction, submitSupportRequestAction, type SupportThread } from "@/app/(app)/help-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/auth/form-field";
import { cn } from "@/lib/utils";

const helpTopics: Array<{ title: string; description: string; icon: LucideIcon; accent: string }> = [
  { title: "Getting Started", description: "Set up your profile and learn the basics.", icon: Rocket, accent: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  { title: "Glow & Visibility", description: "Understand how Glow and visibility work.", icon: Eye, accent: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  { title: "Muddies & Social", description: "Friends, invites, circles, chats and more.", icon: UsersRound, accent: "bg-primary/10 text-primary" },
  { title: "Safety & Privacy", description: "Privacy and safety controls.", icon: Shield, accent: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  { title: "Billing & Premium", description: "Plans, payments and subscriptions.", icon: CreditCard, accent: "bg-pink-500/12 text-pink-600 dark:text-pink-300" },
  { title: "Account & Settings", description: "Manage your account and preferences.", icon: Settings, accent: "bg-teal-500/12 text-teal-600 dark:text-teal-300" }
];

export function HelpCenterPage({ initialThreads = [] }: { initialThreads?: SupportThread[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const contactRef = useRef<HTMLDivElement>(null);

  // Reveal + scroll the message form into view when Contact Support is tapped.
  useEffect(() => {
    if (contactOpen) contactRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [contactOpen]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTopics = helpTopics.filter(
    (topic) => topic.title.toLowerCase().includes(normalizedQuery) || topic.description.toLowerCase().includes(normalizedQuery)
  );

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">How can we help you?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Find answers and get the most out of Mad Buddy.</p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Mad Buddy help..." className="pl-9" aria-label="Search Mad Buddy help" />
        </div>
      </div>

      {initialThreads.length > 0 ? <SupportThreads threads={initialThreads} /> : null}

      <section aria-labelledby="help-topics-heading">
        <h2 id="help-topics-heading" className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-300">
          Help topics
        </h2>
        {visibleTopics.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {visibleTopics.map((topic) => (
              <li key={topic.title}>
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  className="focus-ring safe-motion flex w-full items-center gap-3.5 py-3.5 text-left hover:bg-secondary/30"
                  aria-label={topic.title}
                >
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", topic.accent)}>
                    <topic.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{topic.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{topic.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">No topics match “{query.trim()}”. Try contacting support below.</p>
        )}
      </section>

      <section aria-labelledby="help-more-heading" className="space-y-2">
        <h2 id="help-more-heading" className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-300">
          Need more help?
        </h2>
        <button
          type="button"
          onClick={() => setContactOpen(true)}
          className="focus-ring safe-motion flex w-full items-center gap-3.5 rounded-2xl border border-border/70 bg-card/50 p-3.5 text-left hover:bg-secondary/40"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/12 text-violet-600 dark:text-violet-300">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Contact Support</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Chat with our team and get help.</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <Link
          href="/settings/feedback"
          className="focus-ring safe-motion flex w-full items-center gap-3.5 rounded-2xl border border-border/70 bg-card/50 p-3.5 text-left hover:bg-secondary/40"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Flag className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Report a problem</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Tell us what’s not working.</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </section>

      {contactOpen ? (
        <section ref={contactRef} className="rounded-2xl border border-border/70 bg-card/50 p-5" aria-label="Contact support">
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
                  if (result.ok) {
                    setSent(true);
                    router.refresh(); // surface the new request under "Your requests"
                  } else setFeedback(result.message);
                })}
              >
                {isPending ? "Sending..." : "Send message"}
              </Button>
              {feedback ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{feedback}</p> : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  waiting_on_user: "Awaiting your reply",
  waiting_on_internal_team: "With our team",
  resolved: "Resolved",
  closed: "Closed"
};

function SupportThreads({ threads }: { threads: SupportThread[] }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/50 p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Your requests</h2>
      </div>
      <div className="space-y-3">
        {threads.map((thread) => (
          <SupportThreadCard key={thread.id} thread={thread} />
        ))}
      </div>
    </section>
  );
}

function SupportThreadCard({ thread }: { thread: SupportThread }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const closed = thread.status === "closed";

  function send() {
    startTransition(async () => {
      const result = await replyToSupportThreadAction({ ticketId: thread.id, message: reply.trim() });
      setFeedback(result.message);
      if (result.ok) {
        setReply("");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-border/70 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{thread.subject}</p>
          <p className="text-xs text-muted-foreground">
            {SUPPORT_STATUS_LABELS[thread.status] ?? thread.status} · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{open ? "Hide" : "View"}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border/60 p-3">
          <div className="space-y-2">
            {thread.messages.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  entry.senderType === "user" ? "ml-auto bg-primary/10" : "bg-secondary"
                )}
              >
                <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                  {entry.senderType === "user" ? "You" : entry.senderType === "agent" ? "Support" : "System"}
                </p>
                <p className="whitespace-pre-wrap leading-6">{entry.message}</p>
              </div>
            ))}
          </div>

          {closed ? <p className="text-xs text-muted-foreground">This request is closed — replying reopens it.</p> : null}

          <div className="flex items-start gap-2">
            <Textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Write a reply…"
              maxLength={2000}
              rows={2}
              className="flex-1"
              aria-label="Reply to support"
            />
            <Button type="button" size="sm" onClick={send} disabled={isPending || reply.trim().length < 2}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send
            </Button>
          </div>
          {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
