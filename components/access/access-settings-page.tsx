import Link from "next/link";
import { ArrowLeft, Check, Coffee, Radio, ShieldCheck } from "lucide-react";

import { CheckoutButton } from "@/components/premium/checkout-button";
import { BillingPortalButton } from "@/components/premium/billing-portal-button";
import type { AccessState } from "@/lib/access/resolver";

export type AccessBillingSummary = {
  provider: string | null;
  product: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canCancelHere: boolean;
};

export type AccessSettingsPageProps = {
  access: AccessState;
  hadWelcomeAccess: boolean;
  billing?: AccessBillingSummary | null;
};

const INCLUDED = [
  { icon: Radio, name: "Linkr", description: "Discover and connect with people outside your existing social world." },
  { icon: Coffee, name: "UpFor expansion", description: "Create an UpFor and discover or join people you do not already know. Your own Muddies' UpFors stay free." }
];
const ALWAYS_FREE = [
  "Muddies and existing Linkr connections",
  "Messages and every conversation you already have",
  "Plans, Plan Chat and Events",
  "Glow and proximity with your Muddies",
  "Safe Arrival, Notifications, Circles and Groups"
];
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
function explainAccess(access: AccessState): string {
  if (access.isStaff) return "You have access as a member of the Mad Buddy team.";
  if (access.isPaid) return access.expiresAt ? `You have Mad Buddy Access through ${formatDate(access.expiresAt)}.` : "You have Mad Buddy Access.";
  if (access.isGlobalOverride) return access.expiresAt ? `Mad Buddy Access is open to everyone until ${formatDate(access.expiresAt)}.` : "Mad Buddy Access is currently open to everyone.";
  if (access.isAdminGrant) return access.expiresAt ? `You've been given Mad Buddy Access until ${formatDate(access.expiresAt)}.` : "You've been given Mad Buddy Access.";
  if (access.isWelcomeAccess) {
    const days = access.daysRemaining;
    const when = access.expiresAt ? formatDate(access.expiresAt) : null;
    if (days !== null && days <= 1) return `Your Welcome Access ends today${when ? ` (${when})` : ""}. No payment method was taken, so nothing will be charged.`;
    return `You're on Welcome Access${days !== null ? `, with ${days} ${days === 1 ? "day" : "days"} to go` : ""}${when ? ` (ends ${when})` : ""}. No payment method was taken, so nothing will renew on its own.`;
  }
  return "You don't have Mad Buddy Access right now.";
}

export function AccessSettingsPage({ access, hadWelcomeAccess, billing = null }: AccessSettingsPageProps) {
  const periodEnd = billing?.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : null;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
      <Link href="/settings" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Settings</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Mad Buddy Access</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">One product. GHS 5.00 per month. Your existing social world stays free.</p>

      <section className={`mt-5 rounded-[1.35rem] border p-5 ${access.hasAccess ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-border bg-card/60"}`} aria-labelledby="access-state-title">
        <div className="flex items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${access.hasAccess ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"}`}><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span><h2 id="access-state-title" className="text-base font-semibold">{access.hasAccess ? "Access is active" : "No access right now"}</h2></div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{explainAccess(access)}</p>
        {!access.isPaid && <div className="mt-4"><CheckoutButton /></div>}
      </section>

      {access.isPaid && billing ? (
        <section className="mt-5 rounded-2xl border border-border bg-card/50 p-4" aria-labelledby="billing-state-title">
          <h2 id="billing-state-title" className="text-sm font-semibold">Billing</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Price</dt><dd className="font-medium">GHS 5.00 / month</dd></div>
            {periodEnd ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Current period</dt><dd className="text-right font-medium">through {periodEnd}</dd></div> : null}
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Renewal</dt><dd className="text-right font-medium">{billing.cancelAtPeriodEnd ? "Ends after the current paid period" : "Renews monthly until cancelled"}</dd></div>
          </dl>
          {billing.canCancelHere && !billing.cancelAtPeriodEnd ? <div className="mt-4"><BillingPortalButton label="Cancel at period end" variant="outline" icon="cancel" /></div> : null}
          {billing.provider && billing.provider !== "paystack" ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Manage renewal or cancellation with the store where you bought Access.</p> : null}
        </section>
      ) : null}

      <section className="mt-6" aria-labelledby="access-included-title"><h2 id="access-included-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">What Access includes</h2><div className="mt-3 grid gap-3">{INCLUDED.map((item)=><article key={item.name} className="flex gap-3 rounded-2xl border border-border bg-card/60 p-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><item.icon className="h-4 w-4" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold">{item.name}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p></div></article>)}</div></section>
      <section className="mt-6" aria-labelledby="access-free-title"><h2 id="access-free-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Always free</h2><ul className="mt-3 grid gap-2 rounded-2xl border border-border bg-card/40 p-4">{ALWAYS_FREE.map((item)=><li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{item}</li>)}</ul>{hadWelcomeAccess && !access.hasAccess ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Your existing connections, conversations and Plans were not affected when Welcome Access ended.</p> : null}</section>
    </main>
  );
}
