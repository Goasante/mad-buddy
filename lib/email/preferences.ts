export type EmailCommunicationPreferences = {
  productUpdates: boolean;
  featureLaunches: boolean;
  communityReminders: boolean;
};

export const DEFAULT_EMAIL_COMMUNICATION_PREFERENCES: EmailCommunicationPreferences = {
  productUpdates: true,
  featureLaunches: true,
  communityReminders: true
};

export function normalizeEmailCommunicationPreferences(value: unknown): EmailCommunicationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_EMAIL_COMMUNICATION_PREFERENCES;
  }

  const input = value as Record<string, unknown>;
  return {
    productUpdates:
      typeof input.productUpdates === "boolean"
        ? input.productUpdates
        : DEFAULT_EMAIL_COMMUNICATION_PREFERENCES.productUpdates,
    featureLaunches:
      typeof input.featureLaunches === "boolean"
        ? input.featureLaunches
        : DEFAULT_EMAIL_COMMUNICATION_PREFERENCES.featureLaunches,
    communityReminders:
      typeof input.communityReminders === "boolean"
        ? input.communityReminders
        : DEFAULT_EMAIL_COMMUNICATION_PREFERENCES.communityReminders
  };
}

export function emailPreferencesFromNotificationBlob(value: unknown): EmailCommunicationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_EMAIL_COMMUNICATION_PREFERENCES;
  }
  const email = (value as Record<string, unknown>).email;
  return normalizeEmailCommunicationPreferences(email);
}

export function allowsBroadcastKind(
  preferences: EmailCommunicationPreferences,
  kind: "service_notice" | "product_update" | "feature_launch" | "community_reminder"
) {
  // Service notices are operational/essential and are not treated as optional
  // marketing. They may include downtime, security, or account availability
  // information that users need to receive even when promotional email is off.
  if (kind === "service_notice") return true;
  if (kind === "product_update") return preferences.productUpdates;
  if (kind === "feature_launch") return preferences.featureLaunches;
  return preferences.communityReminders;
}
