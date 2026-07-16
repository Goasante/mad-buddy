export const PRIVACY_POLICY_VERSION = "2026-07-12" as const;

export type PolicyConsentEvent = {
  userId: string;
  policyVersion: typeof PRIVACY_POLICY_VERSION;
  acceptedAt: string;
  source: "signup";
};

export interface ConsentLogger {
  logConsent(event: PolicyConsentEvent): Promise<void>;
}

// TODO(consent): Implement this interface with Supabase only after the
// consent_logs migration, RLS policies, retention rules, and audit access have
// been reviewed. Signup currently validates consent but does not claim that a
// durable consent record has been stored.
export const pendingConsentLogger: ConsentLogger = {
  async logConsent() {
    return Promise.resolve();
  }
};
