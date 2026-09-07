/* `product_rule` matches the combined Doctor's vocabulary: a state that is
   CORRECT and deliberately refused, which must never render a repair button.
   Without it a correct refusal renders as generic `info` and loses the one
   distinction an operator most needs. */
export type AccountDoctorSeverity = "healthy" | "info" | "attention" | "issue" | "product_rule";

export type AccountDoctorArea =
  | "Account"
  | "Messaging"
  | "Relationships"
  | "Plans"
  | "UpFor"
  | "Presence"
  | "Notifications"
  | "Access";

export type AccountDoctorFinding = {
  id: string;
  area: AccountDoctorArea;
  severity: AccountDoctorSeverity;
  title: string;
  detail: string;
  repairId?: string;
};

/**
 * A privacy-minimised support snapshot. It deliberately contains counts and
 * lifecycle state only: no message bodies, exact coordinates, private media,
 * circle membership, Safe Arrival details, or other sensitive content.
 */
export type AccountDoctorSnapshot = {
  isOnboarded: boolean;
  visibilityStatus: string | null;
  hasLocationSignal: boolean;
  staleStatusCount: number;
  unreadNotificationCount: number;
  pushDeviceCount: number;
  activeRateLimitCount: number;
  activeFriendshipCount: number;
  pendingFriendRequestCount: number;
  blockCount: number;
  archivedDirectWithLiveFriendshipCount: number;
  nonJoinedDirectMembershipCount: number;
  planChatMismatchCount: number;
  /**
   * Active Plans this account is going to whose chat correctly excludes them.
   *
   * Counted APART from the mismatch figure. These are the Plan lifecycle
   * refusing on purpose -- a block, a removal, or genuine ineligibility -- and
   * folding them into "needs reconciliation" is what put a repair button in
   * front of a correct refusal.
   */
  planChatBlockedByRuleCount: number;
  staleOwnedUpForCount: number;
  /** Requests still waiting on the viewer's own closed UpFors. */
  strandedUpForRequestCount: number;
  /**
   * Journeys past their arrival time AND grace period but still marked live.
   *
   * A COUNT, deliberately. No destination, timing, route or watcher identity
   * reaches this snapshot -- see lib/admin/event-safety-diagnostics.ts.
   */
  stalledSafeArrivalCount: number;
  /**
   * Journeys that ended without the traveller confirming arrival.
   *
   * Counted SEPARATELY and never mixed into the stalled figure: an unconfirmed
   * arrival is a live safety signal, not a stale record, and Admin must never
   * be offered a way to tidy it away.
   */
  unconfirmedSafeArrivalCount: number;
  /** Events the account is going to but is not a joined circle member of. */
  eventCircleMismatchCount: number;
  /**
   * Events whose circle correctly excludes this account.
   *
   * Separate from the mismatch count for the same reason Plan Chat is: a
   * cancelled Event, an RSVP of no, or an invite-only Event with no invitation
   * are the product working, and folding them into "needs review" is what put
   * a repair next to a correct refusal.
   */
  eventBlockedByRuleCount: number;
};

const severityRank: Record<AccountDoctorSeverity, number> = {
  issue: 0,
  attention: 1,
  product_rule: 2,
  info: 3,
  healthy: 4
};

export function buildAccountDoctorFindings(snapshot: AccountDoctorSnapshot): AccountDoctorFinding[] {
  const findings: AccountDoctorFinding[] = [];

  findings.push({
    id: "account-setup",
    area: "Account",
    severity: snapshot.isOnboarded ? "healthy" : "attention",
    title: snapshot.isOnboarded ? "Account setup is complete" : "Onboarding is incomplete",
    detail: snapshot.isOnboarded
      ? "The profile is marked onboarded."
      : "The account is still marked as needing onboarding. Confirm this matches the user's real journey before resetting anything."
  });

  if (snapshot.archivedDirectWithLiveFriendshipCount > 0) {
    findings.push({
      id: "direct-conversation-mismatch",
      area: "Messaging",
      severity: "issue",
      title: "Direct messaging state is inconsistent",
      detail: `${snapshot.archivedDirectWithLiveFriendshipCount} archived direct conversation${snapshot.archivedDirectWithLiveFriendshipCount === 1 ? "" : "s"} belong to a current unblocked Muddy relationship.`,
      repairId: "reconcile_direct_messaging"
    });
  } else if (snapshot.nonJoinedDirectMembershipCount > 0) {
    findings.push({
      id: "direct-membership-mismatch",
      area: "Messaging",
      severity: "attention",
      title: "Direct conversation membership needs review",
      detail: `${snapshot.nonJoinedDirectMembershipCount} direct membership row${snapshot.nonJoinedDirectMembershipCount === 1 ? " is" : "s are"} not joined.`,
      repairId: "reconcile_direct_messaging"
    });
  } else {
    findings.push({
      id: "direct-messaging-healthy",
      area: "Messaging",
      severity: "healthy",
      title: "Direct messaging lifecycle looks healthy",
      detail: "No archived-live friendship mismatch was detected."
    });
  }

  if (snapshot.planChatBlockedByRuleCount > 0) {
    findings.push({
      id: "plan-chat-blocked-by-rule",
      area: "Plans",
      severity: "product_rule",
      title: "A Plan Chat correctly excludes this account",
      detail: `${snapshot.planChatBlockedByRuleCount} active Plan${snapshot.planChatBlockedByRuleCount === 1 ? "" : "s"} the account is going to ${snapshot.planChatBlockedByRuleCount === 1 ? "does" : "do"} not admit them to the chat. The Plan lifecycle is refusing on purpose — a live block, a removal, or ineligibility — so there is nothing to repair. Check with the host rather than reconciling.`
    });
  }

  if (snapshot.planChatMismatchCount > 0) {
    findings.push({
      id: "plan-chat-mismatch",
      area: "Plans",
      severity: "issue",
      title: "Plan Chat membership needs reconciliation",
      detail: `${snapshot.planChatMismatchCount} active Plan participant state${snapshot.planChatMismatchCount === 1 ? " is" : "s are"} missing a joined Plan Chat membership.`,
      repairId: "reconcile_plan_chats"
    });
  } else {
    findings.push({
      id: "plan-chat-healthy",
      area: "Plans",
      severity: "healthy",
      title: "Plan Chat membership looks healthy",
      detail: "No active Plan participant/chat mismatch was detected."
    });
  }

  if (snapshot.staleOwnedUpForCount > 0) {
    findings.push({
      id: "stale-upfor",
      area: "UpFor",
      severity: "attention",
      title: "Expired UpFor state is still active",
      detail: `${snapshot.staleOwnedUpForCount} owned UpFor session${snapshot.staleOwnedUpForCount === 1 ? " has" : "s have"} passed its end time while still active. This is diagnostic-only until a canonical expiry repair is installed.`
    });
  } else {
    findings.push({
      id: "upfor-healthy",
      area: "UpFor",
      severity: "healthy",
      title: "UpFor lifecycle looks current",
      detail: "No owned active session is already past its end time."
    });
  }

  if (snapshot.staleStatusCount > 0) {
    findings.push({
      id: "stale-status",
      area: "Presence",
      severity: "attention",
      title: "A status failed to expire",
      detail: `${snapshot.staleStatusCount} expired status row${snapshot.staleStatusCount === 1 ? " remains" : "s remain"} active for this account.`,
      repairId: "clear_stuck_status"
    });
  }

  findings.push({
    id: "presence-signal",
    area: "Presence",
    severity: snapshot.hasLocationSignal ? "healthy" : "info",
    title: snapshot.hasLocationSignal ? "Glow signal is present" : "No current Glow signal",
    detail: snapshot.hasLocationSignal
      ? `Visibility is ${snapshot.visibilityStatus ?? "unknown"}; a current presence row exists.`
      : "There is no stored current location signal. This can be normal when location is off or the app has not refreshed yet."
  });

  if (snapshot.activeRateLimitCount > 0) {
    findings.push({
      id: "active-rate-limits",
      area: "Access",
      severity: "attention",
      title: "Active rate-limit window detected",
      detail: `${snapshot.activeRateLimitCount} rate-limit window${snapshot.activeRateLimitCount === 1 ? " is" : "s are"} still active. Only clear this when support has confirmed a legitimate lockout.`,
      repairId: "clear_rate_limits"
    });
  }

  findings.push({
    id: "relationship-summary",
    area: "Relationships",
    severity: "info",
    title: "Relationship state",
    detail: `${snapshot.activeFriendshipCount} active Muddies · ${snapshot.pendingFriendRequestCount} pending requests · ${snapshot.blockCount} active block relationships.`
  });

  if (snapshot.strandedUpForRequestCount > 0) {
    findings.push({
      id: "upfor-stranded-requests",
      area: "UpFor",
      severity: "attention",
      title: "People are waiting on a closed UpFor",
      detail: `${snapshot.strandedUpForRequestCount} request${snapshot.strandedUpForRequestCount === 1 ? " is" : "s are"} still pending on an UpFor that has ended, been cancelled or already become a Plan. They will never be answered as they stand.`
    });
  }

  /* SAFETY, AND THE ORDER MATTERS. The unconfirmed count is reported FIRST and
     carries no repairId: that status means somebody did not confirm arrival
     and their watchers were told, so it is escalated to a person, never tidied
     away by Admin. It is deliberately not merged with the stalled count below,
     which is ordinary lifecycle drift. */
  if (snapshot.unconfirmedSafeArrivalCount > 0) {
    findings.push({
      id: "safe-arrival-unconfirmed",
      area: "Account",
      severity: "issue",
      title: "A journey ended without a confirmed arrival",
      detail: `${snapshot.unconfirmedSafeArrivalCount} Safe Arrival journey${snapshot.unconfirmedSafeArrivalCount === 1 ? "" : "s"} ended without the traveller confirming arrival, and watchers were notified. This is a safety signal, not a stale record — escalate it rather than closing it.`
    });
  }

  if (snapshot.stalledSafeArrivalCount > 0) {
    findings.push({
      id: "safe-arrival-stalled",
      area: "Account",
      severity: "attention",
      title: "A journey is overdue and awaiting the safety sweep",
      detail: `${snapshot.stalledSafeArrivalCount} journey${snapshot.stalledSafeArrivalCount === 1 ? " is" : "s are"} past both the expected arrival and the grace period. The canonical sweep moves these to unconfirmed and alerts the watchers; Admin must not close them, because doing so would skip that alert. If the sweep looks stuck, escalate it.`
    });
  }

  if (snapshot.eventBlockedByRuleCount > 0) {
    findings.push({
      id: "event-blocked-by-rule",
      area: "Plans",
      severity: "product_rule",
      title: "An Event circle correctly excludes this account",
      detail: `${snapshot.eventBlockedByRuleCount} Event${snapshot.eventBlockedByRuleCount === 1 ? "" : "s"} the account has responded to ${snapshot.eventBlockedByRuleCount === 1 ? "does" : "do"} not admit them to the circle — the Event has finished or been cancelled, they answered no or only interested, or it is invite-only and they hold no invitation. There is nothing to repair.`
    });
  }

  if (snapshot.eventCircleMismatchCount > 0) {
    findings.push({
      id: "event-circle-mismatch",
      area: "Plans",
      severity: "attention",
      title: "Event circle membership needs review",
      detail: `${snapshot.eventCircleMismatchCount} Event${snapshot.eventCircleMismatchCount === 1 ? "" : "s"} this account is going to ${snapshot.eventCircleMismatchCount === 1 ? "does" : "do"} not have them as a joined circle member.`
    });
  }

  findings.push({
    id: "notification-summary",
    area: "Notifications",
    severity: "info",
    title: "Notification delivery state",
    detail: `${snapshot.unreadNotificationCount} unread notifications · ${snapshot.pushDeviceCount} registered push device${snapshot.pushDeviceCount === 1 ? "" : "s"}.`
  });

  return findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
}

export function accountDoctorSummary(findings: readonly AccountDoctorFinding[]) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    { issue: 0, attention: 0, info: 0, healthy: 0 } as Record<AccountDoctorSeverity, number>
  );
}
