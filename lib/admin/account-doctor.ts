export type AccountDoctorSeverity = "healthy" | "info" | "attention" | "issue";

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
  staleOwnedUpForCount: number;
};

const severityRank: Record<AccountDoctorSeverity, number> = {
  issue: 0,
  attention: 1,
  info: 2,
  healthy: 3
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
