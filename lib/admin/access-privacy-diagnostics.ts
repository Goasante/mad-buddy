import {
  blockedByRule,
  fixed,
  notApplicable,
  type RepairVerification,
  stillBroken
} from "@/lib/admin/repair-verification";

/**
 * ACCESS / BILLING and PRIVACY / ACCOUNT OPERATIONS diagnostics.
 *
 * The rule that shapes this whole file: ADMIN NEVER GRANTS PAID ACCESS. Not as
 * a favour, not to unblock a frustrated user, not "just for a week". Access
 * comes from a governed entitlement path -- a real payment, a real Welcome
 * window, a real staff role -- and a support tool that can mint it outside
 * those paths is a revenue hole and an audit hole at the same time.
 *
 * What Admin CAN do here is explain. Most billing tickets are not faults:
 * a cancelled subscription that still works until its period end, a lapsed
 * Welcome window, a payment that succeeded at the provider but has not been
 * reconciled yet. Each needs a different sentence, and telling somebody the
 * wrong one either loses their money or gives away the product.
 *
 * Privacy / account operations follows the same shape. An export or deletion
 * that is genuinely stuck is drift Admin may retry; one that is merely SLOW is
 * the product working, and a deletion is never quietly reversed to make a
 * ticket go away.
 *
 * Pure functions over a privacy-minimised view: no card details, no provider
 * customer ids, no payment references, no exported content.
 */

export type AccessSourceKind =
  | "welcome_access"
  | "web_subscription"
  | "apple_subscription"
  | "google_subscription"
  | "admin_grant"
  | "staff"
  | "global_window";

/**
 * The provider statuses the access resolver actually reads.
 *
 * `non_renewing` is the cancelled-but-paid state -- the user turned off
 * renewal and keeps what they paid for until the period ends. It is NOT the
 * same as `cancelled`, which is over. Collapsing the two is how somebody gets
 * told to pay again for time they already own.
 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "non_renewing"
  | "cancelled"
  | "expired"
  | "unpaid";

export type AccessView = {
  /** Whether the resolver currently reports access. */
  hasAccess: boolean;
  /** Which source granted it, when it did. */
  activeSource: AccessSourceKind | null;
  /** Access ends at this instant. Null when indefinite. */
  expiresAt: string | null;
  /** Provider-side subscription state, when one exists. */
  subscriptionStatus: SubscriptionStatus | null;
  /** The paid period the user has already paid for ends here. */
  paidPeriodEndsAt: string | null;
  /** A Welcome Access grant exists (used or current). */
  welcomeGrantExists: boolean;
  /** That Welcome window has already ended. */
  welcomeGrantExpired: boolean;
};

export type PrivacyOperationKind = "export" | "deletion";

export type PrivacyOperationView = {
  operationId: string;
  kind: PrivacyOperationKind;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  /** Hours since the request was made. */
  ageHours: number;
  /** The published turnaround for this operation, in hours. */
  slaHours: number;
};

export type LifecycleFinding = {
  id: string;
  repairable: boolean;
  explanation: string;
};

/**
 * Why this account does or does not have access.
 *
 * The precedence follows the resolver's, and the order carries real money.
 * A cancelled subscription inside its paid period is checked BEFORE "no
 * access", because telling that person they need to pay again would charge
 * them twice for time they already own.
 */
export function explainAccess(view: AccessView, now: Date): RepairVerification {
  const invariant = "the account's access matches the entitlement it has paid for or been granted";

  if (view.hasAccess) {
    if (
      (view.subscriptionStatus === "non_renewing" || view.subscriptionStatus === "cancelled") &&
      view.paidPeriodEndsAt
    ) {
      return fixed(
        invariant,
        "This account cancelled its subscription but has access until the end of the period it already paid for. That is correct — it is not a billing error, and it will lapse on its own."
      );
    }
    if (view.activeSource === "welcome_access") {
      return fixed(
        invariant,
        "This account is inside its Welcome Access window. Access will end when the window does, which is expected rather than a fault."
      );
    }
    return fixed(invariant, "This account currently has access, from a valid entitlement.");
  }

  /* PAID BUT NOT RESOLVING. The one genuine fault in this area, and the only
     one worth escalating: the provider says paid, the product says no. */
  if (
    (view.subscriptionStatus === "active" || view.subscriptionStatus === "trialing") &&
    (view.paidPeriodEndsAt === null || Date.parse(view.paidPeriodEndsAt) > now.getTime())
  ) {
    return stillBroken(
      invariant,
      "This account has a paid subscription inside its current period but the product is not granting access. This is a reconciliation fault — escalate it rather than granting access by hand."
    );
  }

  if (view.subscriptionStatus === "past_due" || view.subscriptionStatus === "unpaid") {
    return blockedByRule(
      invariant,
      "Access follows payment, and a failed payment is the provider's to resolve",
      "This account's most recent payment did not go through and any grace period has run out, so access has stopped. The user needs to fix the payment method — Admin must not grant access to bridge it."
    );
  }

  if (view.welcomeGrantExists && view.welcomeGrantExpired) {
    return blockedByRule(
      invariant,
      "Welcome Access is a one-time window, not a renewable grant",
      "This account's Welcome Access window has ended. It is not reissued, and Admin must not extend it — expanding beyond their existing social world is the paid part of the product."
    );
  }

  if (
    view.subscriptionStatus === "cancelled" ||
    view.subscriptionStatus === "expired" ||
    view.subscriptionStatus === "non_renewing"
  ) {
    return blockedByRule(
      invariant,
      "A cancelled subscription ends when its paid period ends",
      "This account's subscription has ended and its paid period is over. Resubscribing is theirs to do."
    );
  }

  return blockedByRule(
    invariant,
    "Expanding beyond an existing social world requires a current entitlement",
    "This account has no current entitlement. Mad Buddy's existing social world stays free; expanding it is the paid part, and Admin must not grant that outside the normal purchase path."
  );
}

/**
 * The states where a billing repair is even conceivable.
 *
 * Exactly one: a subscription the provider considers paid that the product is
 * not honouring. Everything else in this area is an explanation, which is why
 * this returns findings so rarely.
 *
 * Note it is NOT marked repairable. The fix is a reconciliation the billing
 * system owns; Admin's job is to identify it and escalate, not to paper over
 * it by minting a grant that then diverges from what the provider believes.
 */
export function findAccessReconciliationIssues(view: AccessView, now: Date): LifecycleFinding[] {
  const paidNow =
    (view.subscriptionStatus === "active" || view.subscriptionStatus === "trialing") &&
    (view.paidPeriodEndsAt === null || Date.parse(view.paidPeriodEndsAt) > now.getTime());

  if (paidNow && !view.hasAccess) {
    return [
      {
        id: "access-reconciliation",
        repairable: false,
        explanation:
          "The provider shows this subscription as paid and current, but the product is not granting access. This needs billing reconciliation, not a manual grant."
      }
    ];
  }
  return [];
}

/**
 * A privacy operation that has genuinely stalled.
 *
 * SLOW IS NOT STUCK. An export inside its published turnaround is the product
 * working, and retrying it wastes a job slot while telling the user something
 * was wrong. Only work that has passed its own SLA, or failed outright,
 * counts.
 */
export function findStalledPrivacyOperations(
  operations: readonly PrivacyOperationView[]
): LifecycleFinding[] {
  return operations
    .filter((operation) => {
      if (operation.status === "failed") return true;
      if (operation.status !== "queued" && operation.status !== "running") return false;
      return operation.ageHours > operation.slaHours;
    })
    .map((operation) => ({
      id: operation.operationId,
      /* A failed EXPORT is safe to retry: it produces a file the user already
         asked for. A failed DELETION is not, because a partial deletion may
         have already removed data, and re-running it blind can neither be
         verified nor undone from here. */
      repairable: operation.kind === "export",
      explanation:
        operation.kind === "export"
          ? `This data export has been ${operation.status} for ${Math.round(operation.ageHours)}h, past its ${operation.slaHours}h turnaround. It can be retried.`
          : `This account deletion has been ${operation.status} for ${Math.round(operation.ageHours)}h, past its ${operation.slaHours}h turnaround. It must be escalated — a partially-applied deletion cannot be safely re-run from Admin.`
    }));
}

/**
 * What Support may say about a privacy operation.
 *
 * A deletion in progress is never reversed here. People ask for that -- "I
 * changed my mind" -- and the answer is a new account, because a deletion that
 * has begun cannot be proven complete-or-undone from a support console.
 */
export function explainPrivacyOperation(operation: PrivacyOperationView): RepairVerification {
  const invariant = "the privacy request is progressing within its published turnaround";

  if (operation.status === "completed") {
    return notApplicable(invariant, `This ${operation.kind} has already completed.`);
  }

  if (operation.status === "cancelled") {
    return notApplicable(invariant, `This ${operation.kind} was cancelled, so there is nothing in progress.`);
  }

  if (operation.kind === "deletion" && (operation.status === "queued" || operation.status === "running")) {
    return blockedByRule(
      invariant,
      "An account deletion in progress is not reversed from Admin",
      "This deletion is under way. It cannot be undone here — if the user has changed their mind, they need a new account, and any partial deletion must be confirmed by engineering rather than assumed."
    );
  }

  if (operation.ageHours <= operation.slaHours && operation.status !== "failed") {
    return fixed(
      invariant,
      `This ${operation.kind} is still within its ${operation.slaHours}h turnaround. It is progressing normally, not stuck.`
    );
  }

  return stillBroken(
    invariant,
    `This ${operation.kind} is ${operation.status} and past its ${operation.slaHours}h turnaround.`
  );
}

/**
 * Verifier for retrying a stalled export. Claims the retry, nothing else.
 *
 * NOT CURRENTLY WIRED TO A REPAIR, deliberately. `privacy_requests` has no job
 * runner: the only code that touches it is an admin action where a HUMAN moves
 * the status by hand. A "retry export" button would therefore flip a status
 * with nothing to act on it and report success -- the exact
 * mutation-succeeded-so-it-must-be-fixed lie the verification contract exists
 * to prevent.
 *
 * So stalled exports stay DIAGNOSTIC-ONLY: Admin surfaces them and the
 * operator progresses the request through the existing privacy console. This
 * verifier is kept ready for the day a queue exists, and the day it does, the
 * repair is a few lines.
 */
export function verifyExportRetry(input: { attempted: number; stillFailed: number }): RepairVerification {
  const invariant = "no data export is left failed or past its turnaround";

  if (input.attempted === 0) {
    return notApplicable(invariant, "This account has no stalled data exports.");
  }
  if (input.stillFailed > 0) {
    return stillBroken(
      invariant,
      `${input.stillFailed} export${input.stillFailed === 1 ? "" : "s"} could not be requeued.`
    );
  }
  return fixed(
    invariant,
    `${input.attempted} export${input.attempted === 1 ? "" : "s"} requeued. The user will receive the file when it completes; no account data was changed.`
  );
}
