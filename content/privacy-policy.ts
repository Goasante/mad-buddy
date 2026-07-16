export { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "12 July 2026";
export const PRIVACY_POLICY_LAST_UPDATED = "12 July 2026";

export const legalContactPlaceholders = {
  // TODO(legal): Replace every placeholder before production launch.
  companyName: "[LEGAL COMPANY NAME]",
  businessAddress: "[REGISTERED BUSINESS ADDRESS]",
  privacyEmail: "[PRIVACY EMAIL ADDRESS]",
  supportEmail: "[SUPPORT EMAIL ADDRESS]"
} as const;

// TODO(legal-review): Reconfirm background location, retention, international
// transfer safeguards, and every security-control statement before launch.
// Account deletion currently exists, but its production behavior must be
// verified against deployed database functions, storage, and billing records.
export const privacyPolicyMarkdown = ``;
