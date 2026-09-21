import { Check, Clock, CreditCard, Crown, ShieldCheck, Smartphone } from "lucide-react";

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

/** What owning Mad Buddy Access changes under the ads-first model. */
const ACCESS_BENEFITS = [
  {
    name: "No banner or inline ads",
    description: "Browse Mad Buddy without advertising inserted between content."
  },
  {
    name: "No full-screen ads",
    description: "Access accounts are excluded from interstitial advertising wherever Mad Buddy controls it."
  },
  {
    name: "The same Mad Buddy, uninterrupted",
    description: "Access removes ads; it does not create a separate version of your social experience."
  }
];

/** Free users keep the product itself; advertising is the monetization boundary. */
const FREE_WITH_ADS = [
  "Home, Muddies, Glow and proximity",
  "Linkr discovery and connections",
  "UpFor discovery, creation and joining",
  "Messages and every conversation",
  "Plans, Plan Chat and Events",
  "Safe Arrival, Notifications, Circles and Groups"
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function statusSummary(access: AccessState, billing: AccessBillingSummary | null): {
  icon: typeof ShieldCheck;
  heading: string;
  detail: string;
  sub: string | null;
} {
  if (access.isStaff) {
    return {
      icon: Crown,
      heading: "Ad-free Access active",
      detail: "Member of the Mad Buddy team",
      sub: "No payment required"
    };
  }

  if (access.isAdminGrant) {
    const when = access.expiresAt ? `Ad-free until ${formatDate(access.expiresAt)}` : "Ad-free, no end date";
    return { icon: ShieldCheck, heading: "Ad-free Access active", detail: when, sub: "Given by Mad Buddy, no payment required" };
  }

  if (access.isGlobalOverride) {
    const when = access.expiresAt ? `Ad-free until ${formatDate(access.expiresAt)}` : "Currently ad-free";
    return { icon: ShieldCheck, heading: "Ad-free Access active", detail: when, sub: "No payment required" };
  }

  if (access.isPaid && billing) {
    if (billing.status === "past_due") {
      return {
        icon: Clock,
        heading: "Ad-free Access active",
        detail: billing.graceEndsAt
          ? `Payment retry in progress — ad-free Access continues until ${formatDate(billing.graceEndsAt)}`
          : "Payment retry in progress",
        sub: "Update your card to keep the ad-free experience after the retry window"
      };
    }
    if (billing.isManualRenewal && billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Ad-free Access active",
        detail: `Valid until ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Paid with Mobile Money"
      };
    }
    if (billing.cancelAtPeriodEnd && billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Ad-free Access active",
        detail: `Active until ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Renewal is turned off"
      };
    }
    if (billing.currentPeriodEnd) {
      return {
        icon: ShieldCheck,
        heading: "Ad-free Access active",
        detail: `Renews ${formatDate(billing.currentPeriodEnd)}`,
        sub: "Paid with Card"
      };
    }
    return { icon: ShieldCheck, heading: "Ad-free Access active", detail: "Paid Access", sub: null };
  }

  if (access.isPaid) {
    return { icon: ShieldCheck, heading: "Ad-free Access active", detail: "Paid Access", sub: null };
  }

  if (access.isWelcomeAccess) {
    const days = access.daysRemaining;
    const when = access.expiresAt ? formatDate(access.expiresAt) : null;
    if (days !== null && days <= 1) {
      return {
        icon: Clock,
        heading: "Ad-free Welcome Access",
        detail: `Your ad-free welcome period ends today${when ? ` (${when})` : ""}`,
        sub: "Nothing will be charged — you never added a payment method"
      };
    }
    return {
      icon: Clock,
      heading: "Ad-free Welcome Access",
      detail: `Welcome Access${days !== null ? ` · ${days} ${days === 1 ? "day" : "days"} left` : ""}${when ? ` (ends ${when})` : ""}`,
      sub: "No payment method was taken — nothing renews on its own"
    };
  }

  return {
    icon: ShieldCheck,
    heading: "Using Mad Buddy with ads",
    detail: "All core Mad Buddy features remain available",
    sub: "Get Mad Buddy Access to remove advertising"
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
  const showMomoActive = paymentIsApplicable && access.isPaid && billing?.isManualRenewal;

  return (
    <div className="mr-auto w-full max-w-2xl pt-2 sm:pt-6">
      <SettingsSubHeader title="Mad Buddy Access" />

      <div className="pb-10 pt-3 sm:pt-4">
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
            <h2 id="access-state-title" className="flex items-center gap-1.5 text-sm font-semibold">
              {access.hasAccess ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : null}
              {summary.heading}
            </h2>
            <p className="mt-1 text-sm leading-6 text-foreground">{summary.detail}</p>
            {summary.sub ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{summary.sub}</p> : null}
          </div>
        </section>

        <section className="mt-5" aria-labelledby="access-benefits-title">
          <h2 id="access-benefits-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What Access gives you
          </h2>
          <div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border bg-card/40">
            {ACCESS_BENEFITS.map((item) => (
              <div key={item.name} className="flex items-start gap-3 p-3.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5">{item.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5" aria-labelledby="access-free-title">
          <h2 id="access-free-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Free with ads
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            You do not need Access to use Mad Buddy. The free experience keeps the core product and may show advertising.
          </p>
          <ul className="mt-2 grid gap-2 rounded-2xl border border-border bg-card/40 p-3.5">
            {FREE_WITH_ADS.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          {hadWelcomeAccess && !access.hasAccess ? (
            <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
              Your Welcome Access ended, so your account may now show ads. Your features, connections, conversations and Plans are still available.
            </p>
          ) : null}
        </section>

        {paymentIsApplicable ? (
          <section className="mt-5" aria-labelledby="access-payment-title">
            <h2 id="access-payment-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {showChooser ? "Remove ads" : "Billing"}
            </h2>

            {showChooser ? (
              <div className="mt-2">
                <p className="text-sm font-medium text-foreground">Mad Buddy without ads · GHS 4.99 / 30 days</p>
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
                        ? "One-time 30-day ad-free Access — pay again to renew"
                        : billing?.cancelAtPeriodEnd
                          ? "Renewal turned off — ad-free Access ends at period end"
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
                    You can pay for another 30 ad-free days once this period ends.
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

/** A read-only billing summary row. */
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
