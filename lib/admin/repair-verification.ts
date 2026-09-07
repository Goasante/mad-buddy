/**
 * THE REPAIR VERIFICATION CONTRACT.
 *
 * A repair is not complete because an UPDATE or an RPC returned success. That
 * only proves a write was accepted -- not that the thing Support was asked to
 * fix is actually fixed. The two come apart constantly:
 *
 *   - a reconciler runs cleanly and changes nothing, because the real blocker
 *     was a live block it correctly refused to cross;
 *   - an update matches zero rows and reports success;
 *   - the write lands but a second invariant (membership, entitlement) is
 *     still wrong, so the user still cannot do the thing they reported.
 *
 * So every repair recipe must name an INVARIANT VERIFIER: a re-read, after the
 * write, of the state the user actually experiences. The verifier decides the
 * outcome, never the mutation's return value.
 *
 * The four outcomes are deliberately not two. "Didn't work" collapses three
 * very different situations that need different responses from Support:
 *
 *   FIXED                  the invariant now holds. Say so, close the ticket.
 *   STILL_BROKEN           the invariant does not hold. Escalate; this is
 *                          probably a product defect, not account drift.
 *   NOT_APPLICABLE         there was nothing to repair. The report was about
 *                          something else -- keep diagnosing, do not re-run.
 *   BLOCKED_BY_PRODUCT_RULE the state is CORRECT and the product is refusing
 *                          on purpose (a live block, an age gate, a lapsed
 *                          entitlement). Never repair past this. Explain it.
 *
 * That last one is the reason this file exists rather than a boolean. A
 * support tool whose only vocabulary is "fixed / not fixed" will eventually be
 * used to force past a block, because the operator cannot tell the difference
 * between a bug and a rule. Making the rule a first-class, non-actionable
 * outcome is what keeps Admin inside the security model.
 */

export type RepairOutcome = "fixed" | "still_broken" | "not_applicable" | "blocked_by_product_rule";

export type RepairVerification = {
  outcome: RepairOutcome;
  /** One sentence for the operator, in plain language. Never raw SQL or ids. */
  summary: string;
  /**
   * The invariant that was re-read, named so the operator can see WHAT was
   * checked rather than trusting the word "verified".
   */
  invariant: string;
  /**
   * Present only for `blocked_by_product_rule`: which rule, so Support can
   * explain it to the user instead of escalating a non-defect.
   */
  rule?: string;
};

/** Whether this outcome means the operator should stop and explain, not retry. */
export function isTerminal(outcome: RepairOutcome): boolean {
  return outcome === "fixed" || outcome === "blocked_by_product_rule";
}

/** Whether this outcome should be escalated to engineering rather than retried. */
export function needsEscalation(outcome: RepairOutcome): boolean {
  return outcome === "still_broken";
}

export function verificationTone(outcome: RepairOutcome): "success" | "danger" | "muted" | "warning" {
  switch (outcome) {
    case "fixed":
      return "success";
    case "still_broken":
      return "danger";
    case "blocked_by_product_rule":
      return "warning";
    case "not_applicable":
      return "muted";
  }
}

export const OUTCOME_LABEL: Record<RepairOutcome, string> = {
  fixed: "Fixed",
  still_broken: "Still broken",
  not_applicable: "Nothing to repair",
  blocked_by_product_rule: "Blocked by a product rule"
};

/**
 * What the operator should do next. Support reads this, not the enum.
 *
 * `still_broken` deliberately says escalate rather than "try again": a repair
 * that ran correctly and left the invariant false is evidence of a defect, and
 * running it a second time produces the same result while looking like effort.
 */
export const OUTCOME_GUIDANCE: Record<RepairOutcome, string> = {
  fixed: "The account state now matches what the user expects. Confirm with them and close the ticket.",
  still_broken:
    "The repair ran but the account is still in the reported state. Do not re-run it — escalate to engineering with this ticket.",
  not_applicable:
    "This account was already healthy in this area, so nothing was changed. The report is probably about a different area — keep diagnosing.",
  blocked_by_product_rule:
    "This is not a fault. Mad Buddy is refusing on purpose and Admin must not override it. Explain the rule to the user."
};

export const fixed = (invariant: string, summary: string): RepairVerification => ({
  outcome: "fixed",
  invariant,
  summary
});

export const stillBroken = (invariant: string, summary: string): RepairVerification => ({
  outcome: "still_broken",
  invariant,
  summary
});

export const notApplicable = (invariant: string, summary: string): RepairVerification => ({
  outcome: "not_applicable",
  invariant,
  summary
});

export const blockedByRule = (invariant: string, rule: string, summary: string): RepairVerification => ({
  outcome: "blocked_by_product_rule",
  invariant,
  rule,
  summary
});
