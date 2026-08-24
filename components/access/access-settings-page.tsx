import Link from "next/link";
import { ArrowLeft, Check, Radio, Coffee, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccessState } from "@/lib/access/resolver";

/**
 * Settings → Mad Buddy Access.
 *
 * The administrative home for access state. It lives in Settings, not Profile:
 * Profile is how other people see you, Settings is where you manage the
 * account, and membership status is not a thing you present to others. Profile
 * IA is locked and this deliberately stays out of it.
 *
 * WHAT IT SHOWS, AND WHAT IT REFUSES TO SHOW.
 *
 * It answers "do I have access, why, and until when" in the user's own words.
 * It does NOT print internal source identifiers -- `welcome_access`,
 * `global_promo`, `admin_grant` are implementation names, and a person reading
 * "your access source is global_promo" learns nothing except that somebody let
 * a database column reach the UI. Each source gets a human sentence instead.
 *
 * There is no countdown, no urgency, and no scarcity. The expiry date is a
 * fact stated once.
 */

export type AccessSettingsPageProps = {
  access: AccessState;
  /** True when this account has ever held Welcome Access, current or past. */
  hadWelcomeAccess: boolean;
};

const INCLUDED = [
  { icon: Radio, name: "Linkr", description: "Meet people you don't know yet, while your session is on." },
  { icon: Coffee, name: "UpFor", description: "Say what you're open to and find people up for the same." }
];

const ALWAYS_FREE = [
  "Muddies and your existing connections",
  "Messages and every conversation you already have",
  "Plans, Plan chat and Events",
  "Glow and proximity with your Muddies",
  "Safe Arrival"
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

/**
 * One honest sentence per source.
 *
 * Ordered by what the person most needs to know. A paying customer is told
 * they are paying; somebody inside a promotion is told the promotion is why,
 * so its ending is not a surprise.
 */
function explainAccess(access: AccessState): string {
  if (access.isStaff) return "You have access as a member of the Mad Buddy team.";
  if (access.isPaid) {
    return access.expiresAt
      ? `You have Mad Buddy Access. Your current period runs until ${formatDate(access.expiresAt)}.`
      : "You have Mad Buddy Access.";
  }
  if (access.isGlobalOverride) {
    return access.expiresAt
      ? `Mad Buddy Access is open to everyone until ${formatDate(access.expiresAt)}.`
      : "Mad Buddy Access is currently open to everyone.";
  }
  if (access.isAdminGrant) {
    return access.expiresAt
      ? `You've been given Mad Buddy Access until ${formatDate(access.expiresAt)}.`
      : "You've been given Mad Buddy Access.";
  }
  if (access.isWelcomeAccess) {
    /* No countdown, and no urgency below four days. The number is a fact the
       person asked for by opening this page, not a lever. */
    const days = access.daysRemaining;
    const when = access.expiresAt ? formatDate(access.expiresAt) : null;
    if (days !== null && days <= 1) {
      return `Your Welcome Access ends today${when ? ` (${when})` : ""}. No payment method was taken, so nothing will be charged.`;
    }
    return `You're on Welcome Access${days !== null ? `, with ${days} ${days === 1 ? "day" : "days"} to go` : ""}${when ? ` (ends ${when})` : ""}. No payment method was taken, so nothing will renew on its own.`;
  }
  return "You don't have Mad Buddy Access right now.";
}

export function AccessSettingsPage({ access, hadWelcomeAccess }: AccessSettingsPageProps) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
      <Link
        href="/settings"
        className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Settings
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Mad Buddy Access</h1>

      {/* CURRENT STATE, first and plainly. */}
      <section
        className={`mt-5 rounded-[1.35rem] border p-5 ${
          access.hasAccess
            ? "border-emerald-500/25 bg-emerald-500/[0.06]"
            : "border-border bg-card/60"
        }`}
        aria-labelledby="access-state-title"
      >
        <div className="flex items-center gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              access.hasAccess ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"
            }`}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 id="access-state-title" className="text-base font-semibold">
            {access.hasAccess ? "Access is active" : "No access right now"}
          </h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{explainAccess(access)}</p>

        {!access.hasAccess && (
          <div className="mt-4">
            <Button asChild size="lg">
              <Link href="/settings/access">Get Mad Buddy Access</Link>
            </Button>
          </div>
        )}
      </section>

      {/* WHAT IT INCLUDES. Two features, named, so "Access" is not an abstraction. */}
      <section className="mt-6" aria-labelledby="access-included-title">
        <h2 id="access-included-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          What Access includes
        </h2>
        <div className="mt-3 grid gap-3">
          {INCLUDED.map((item) => (
            <article key={item.name} className="flex gap-3 rounded-2xl border border-border bg-card/60 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{item.name}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* WHAT IS FREE REGARDLESS. Given equal weight, because it is most of the
          product and the reason this boundary is defensible at all. */}
      <section className="mt-6" aria-labelledby="access-free-title">
        <h2 id="access-free-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Always free
        </h2>
        <ul className="mt-3 grid gap-2 rounded-2xl border border-border bg-card/40 p-4">
          {ALWAYS_FREE.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
              <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        {hadWelcomeAccess && !access.hasAccess && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Your existing connections and conversations were not affected when Welcome Access ended.
          </p>
        )}
      </section>
    </main>
  );
}
