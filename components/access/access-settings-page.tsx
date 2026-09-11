import { Check, Clock, Coffee, CreditCard, Crown, Radio, ShieldCheck, Smartphone } from "lucide-react";

import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
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
  /** `non_renewing` with no Paystack subscription code: a manual Mobile Money period, not a cancelled card. */
  isManualRenewal: boolean;
  /**
   * Only meaningful while `status === "past_due"`. The resolver
   * (`lib/access/resolver.ts` `loadPaidSubscription`) treats THIS, not
   * `currentPeriodEnd`, as the real end of a payment-retry grace window --
   * `currentPeriodEnd` on a past_due row is already in the past.
   */
  graceEndsAt: string | null;
};

export type AccessSettingsPageProps = {
  access: AccessState;
  hadWelcomeAccess: boolean;
  billing?: AccessBillingSummary | null;
};

/**
 * WHAT ACCESS UNLOCKS.
 *
 * Exactly the two surfaces `lib/access/guard.ts` gates -- discovery/creation
 * on Linkr and UpFor. Copy names what expands, not the enforcement mechanism:
 * nobody outside this codebase thinks in terms of "gated surfaces".
 */
const UNLOCKS = [
  {
    icon: Radio,
    name: "Discover new people with Linkr",
    description: "Meet people outside your existing social circle."
  },
  {
    icon: Coffee,
    name: "Meet more people through UpFor",
    description: "Create or join UpFors beyond your existing Muddies."
  }
];

/**
 * ALWAYS YOURS.
 *
 * Matches `lib/access/guard.ts`'s NEVER-GATED list exactly: an existing
 * Linkr connection and its conversation, every message, Plans made from an
 * UpFor with their chat and participants, and everything outside Linkr/UpFor
 * entirely. Grouped only where the guarantee genuinely differs -- Linkr
 * carries one extra line because "existing connections stay free" is easy to
 * misread as "Linkr stays free", and the two are not the same claim.
 */
const ALWAYS_YOURS = [
  "Muddies and existing Linkr connections",
  "Messages and every conversation you already have",
  "Plans, Plan Chat and Events",
  "Glow and proximity with your Muddies",
  "Safe Arrival, Notifications, Circles and Groups"
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * One compact status line per real state. Never fabricates a detail a state
 * does not actually carry (no card digits -- the provider integration stores
 * only an opaque authorization code, never last four).
 */
function statusSummary(access: AccessState, billing: AccessBillingSummary | null): {
  icon: typeof ShieldCheck;
  heading: string;
  detail: string;
  sub: string | null;
} {
  if (access.isStaff) {
    return {
      icon: Crown,
      heading: "Access active",
      detail: "Member of the Mad Buddy team",
      sub: "No payment required"
    };
  }

  if (access.isAdminGrant) {
    const when = access.expiresAt ? `Until ${formatDate(access.expiresAt)}` : "Given, no end date";
    return { icon: ShieldCheck, heading: "Access active", detail: when, sub: "Given by Mad Buddy, no payment required" };
  }

  if (access.isGlobalOverride) {
    const when = access.expiresAt ? `Open to everyone until ${formatDate(access.expiresAt)}` : "Currently open to everyone";
    return { icon: ShieldCheck, heading: "Access active", detail: when, sub: "No payment required" };
  }

  if (access.isPaid && billing) {
    // Payment retry in progress. Access is still genuinely active -- the
    // resolver honours the grace window -- but the last renewal attempt
    // failed, and saying "renews" here would be false: nothing renewed.
    if (billing.status === "past_due") {
      return {
        icon: Clock,
        heading: "Access active",
        detail: billing.graceEndsAt
          ? `Payment retry in progress — access continues until ${formatDate(billing.graceEndsAt)}`
          : "Payment retry in progress",
        sub: "Update your card to keep Access after the retry window"
      };
    }
    if (billing.isManualRenewal && billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Access active",
        detail: `Valid until ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Paid with Mobile Money"
      };
    }
    if (billing.cancelAtPeriodEnd && billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Access active",
        detail: `Active until ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Renewal is turned off"
      };
    }
    if (billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Access active",
        detail: `Renews ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Paid with Card"
      };
    }
    return { icon: ShieldCheck, heading: "Access active", detail: "Paid access", sub: null };
  }

  // Defensive: `access.isPaid` came back true (a live provider subscription
  // exists) but the page's billing summary did not load. Access itself is
  // still real and active -- resolveAccessForUser is the authority, not this
  // display query -- so this must never fall through to "no access".
  if (access.isPaid) {
    return { icon: ShieldCheck, heading: "Access active", detail: "Paid access", sub: null };
  }

  if (access.isWelcomeAccess) {
    const days = access.daysRemaining;
    const when = access.expiresAt ? formatDate(access.expiresAt) : null;
    if (days !== null && days <= 1) {
      return {
        icon: Clock,
        heading: "Access active",
        detail: `Welcome Access ends today${when ? ` (${when})` : ""}`,
        sub: "No payment method was taken — nothing will be charged"
      };
    }
    return {
      icon: Clock,
      heading: "Access active",
      detail: `Welcome Access${days !== null ? ` · ${days} ${days === 1 ? "day" : "days"} left` : ""}${when ? ` (ends ${when})` : ""}`,
      sub: "No payment method was taken — nothing renews on its own"
    };
  }

  return {
    icon: ShieldCheck,
    heading: "Access ended",
    detail: "Renew to regain Linkr and UpFor discovery",
    sub: null
  };
}

export function AccessSettingsPage({ access, hadWelcomeAccess, billing = null }: AccessSettingsPageProps) {
  const summary = statusSummary(access, billing);
  const SummaryIcon = summary.icon;

  // Team, complimentary and global-override access are never payable here —
  // the product has no path that converts a granted account to a paid one,
  // it is simply one union of independent sources (lib/access/resolver.ts).
  const paymentIsApplicable = !access.isStaff && !access.isAdminGrant && !access.isGlobalOverride;
  const showChooser = paymentIsApplicable && !access.isPaid;
  const showManageCard =
    paymentIsApplicable && access.isPaid && billing && !billing.isManualRenewal && billing.provider === "paystack";
  // No "renew now" action while Mobile Money is still live: the checkout
  // route deliberately blocks starting a second paid period on top of a live
  // one (app/api/access/checkout/route.ts, hasLivePaidAccess) to prevent a
  // double purchase, so offering the button here would just produce a
  // guaranteed-failing action. The re-purchase choice belongs to the expired
  // state, where showChooser already renders it.
  const showMomoActive = paymentIsApplicable && access.isPaid && billing?.isManualRenewal;

  return (
    <div className="mr-auto w-full max-w-2xl pt-2 sm:pt-6">
      <SettingsSubHeader title="Mad Buddy Access" />

      {/* A plain div, not <main> -- AppShell's own <main id="app-main-content">
          already wraps every route (components/app-shell/app-shell.tsx), and
          a document may only have one <main> landmark. A second one here
          would break the landmark screen readers use to jump straight to
          content. */}
      <div className="pb-10 pt-3 sm:pt-4">
        {/* ── 1. STATUS: do I have access, why, until when — first and alone. ── */}
        <section
          className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-4"
          aria-labelledby="access-state-title"
        >
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              access.hasAccess ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"
            }`}
          >
            <SummaryIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            {/* h2, not h1 -- SettingsSubHeader already renders the page's one
                h1 (fixed mobile title / desktop in-content heading), so a
                second h1 here would break the one-h1-per-page hierarchy
                screen readers rely on to navigate by landmark. */}
            <h2 id="access-state-title" className="flex items-center gap-1.5 text-sm font-semibold">
              {/* Active state is never colour-only: the check glyph and the
                  word "active" both carry the meaning, not just the emerald
                  tint on the icon badge above. */}
              {access.hasAccess ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : null}
              {summary.heading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-foreground">{summary.detail}</p>
            {summary.sub ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{summary.sub}</p> : null}
          </div>
        </section>

        {/* ── 2. WHAT ACCESS UNLOCKS — always visible, so a paying member sees what they bought and an expired one sees what they'd get back. ── */}
        <section className="mt-5" aria-labelledby="access-unlocks-title">
          <h2 id="access-unlocks-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What Access unlocks
          </h2>
          <div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border bg-card/40">
            {UNLOCKS.map((item) => (
              <div key={item.name} className="flex items-start gap-3 p-3.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5">{item.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 3. ALWAYS YOURS — the non-negotiable guarantee, kept visible in every state, expired included, so it never reads as a hard paywall. ── */}
        <section className="mt-5" aria-labelledby="access-free-title">
          <h2 id="access-free-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Always yours
          </h2>
          <ul className="mt-2 grid gap-2 rounded-2xl border border-border bg-card/40 p-3.5">
            {ALWAYS_YOURS.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          {hadWelcomeAccess && !access.hasAccess ? (
            <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
              Your existing connections, conversations and Plans were not affected when Welcome Access ended.
            </p>
          ) : null}
        </section>

        {/* ── 4. PAYMENT / MANAGE — contextual to the real state, never nested inside the status card. ── */}
        {paymentIsApplicable ? (
          <section className="mt-5" aria-labelledby="access-payment-title">
            <h2 id="access-payment-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {showChooser ? "Get Mad Buddy Access" : "Billing"}
            </h2>

            {showChooser ? (
              <div className="mt-2">
                <p className="text-sm font-medium text-foreground">GHS 4.99 / 30 days</p>
                <div className="mt-3">
                  <CheckoutButton />
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-2xl border border-border bg-card/40 p-3.5">
                <PaymentMethodRow
                  icon={billing?.status === "past_due" ? Clock : billing?.isManualRenewal ? Smartphone : CreditCard}
                  label={billing?.isManualRenewal ? "Mobile Money" : "Card"}
                  detail={
                    billing?.status === "past_due"
                      ? "Last renewal attempt failed — retrying automatically"
                      : billing?.isManualRenewal
                        ? "One-time 30-day access — pay again to renew"
                        : billing?.cancelAtPeriodEnd
                          ? "Renewal turned off — access ends at period end"
                          : "Renews monthly until cancelled"
                  }
                  price={
                    billing?.status === "past_due"
                      ? billing.graceEndsAt
                        ? `retry until ${formatDate(billing.graceEndsAt)}`
                        : "retrying"
                      : billing?.currentPeriodEnd
                        ? `through ${formatDate(billing.currentPeriodEnd)}`
                        : "GHS 4.99"
                  }
                />

                {showMomoActive ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    You can pay for another 30 days once this period ends.
                  </p>
                ) : null}

                {showManageCard ? (
                  <div className="mt-3 space-y-2">
                    {!billing?.cancelAtPeriodEnd && billing?.canCancelHere ? (
                      <BillingPortalButton label="Cancel at period end" variant="outline" icon="cancel" />
                    ) : null}
                    {billing?.provider && billing.provider !== "paystack" ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Manage renewal or cancellation with the store where you bought Access.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A read-only billing summary row -- NOT a navigable control, so it carries
 * no chevron. An arrow here would promise a tap target that does nothing;
 * the actual actions (cancel, store-managed) render below it as real buttons.
 */
function PaymentMethodRow({
  icon: Icon,
  label,
  detail,
  price
}: {
  icon: typeof CreditCard;
  label: string;
  detail: string;
  price: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3] dark:bg-secondary dark:text-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      <span className="shrink-0 text-xs font-medium text-foreground">{price}</span>
    </div>
  );
}
