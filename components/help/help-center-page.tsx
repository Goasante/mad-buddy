"use client";

import {
  CreditCard,
  Eye,
  LifeBuoy,
  MessageSquare,
  Rocket,
  Search,
  Send,
  Settings,
  Shield
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTransition } from "react";
import { replyToSupportThreadAction, submitSupportRequestAction, type SupportThread } from "@/app/(app)/help-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/auth/form-field";
import { cn } from "@/lib/utils";

const popularTopics = [
  { title: "Getting Started", description: "Learn the basics and set up your profile.", icon: Rocket },
  { title: "Glow & Visibility", description: "Understand how Glow and visibility work.", icon: Eye },
  { title: "Meet & Plans", description: "How to create, join, and manage plans.", icon: LifeBuoy },
  { title: "Safety & Privacy", description: "Keep your account and data safe.", icon: Shield },
  { title: "Billing & Premium", description: "Manage payments, plans, and refunds.", icon: CreditCard },
  { title: "Account & Settings", description: "Update your profile and preferences.", icon: Settings }
];

export function HelpCenterPage({ initialThreads = [] }: { initialThreads?: SupportThread[] }) {
  const router = useRouter();
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

      {initialThreads.length > 0 ? <SupportThreads threads={initialThreads} /> : null}

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
