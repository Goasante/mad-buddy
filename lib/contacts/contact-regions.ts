import type { CountryCode } from "libphonenumber-js/min";

import { DEFAULT_PHONE_REGION } from "@/lib/contacts/phone-normalization";

/**
 * Regions shown in the compact owner-facing number form.
 *
 * The parser itself supports every country when the person types an
 * international number beginning with +. This list is only a convenience for
 * common local-number entry, and it is shared by Settings and Find Your
 * Muddies so the two surfaces cannot drift.
 */
export const CONTACT_REGIONS = [
  { code: "GH", label: "Ghana (+233)" },
  { code: "NG", label: "Nigeria (+234)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "US", label: "United States (+1)" },
  { code: "CA", label: "Canada (+1)" },
  { code: "ZA", label: "South Africa (+27)" },
  { code: "KE", label: "Kenya (+254)" },
  { code: "DE", label: "Germany (+49)" },
  { code: "FR", label: "France (+33)" },
  { code: "IN", label: "India (+91)" }
] as const satisfies ReadonlyArray<{ code: CountryCode; label: string }>;

const listed = new Set<string>(CONTACT_REGIONS.map((entry) => entry.code));

/**
 * Best-effort device-region guess for local-format contacts when the user has
 * not added their own number yet.
 *
 * This never decides account identity. It only tells libphonenumber how to
 * interpret a saved national-format string such as 024…; explicit +E.164
 * numbers ignore this default entirely.
 */
export function contactRegionFromLocale(locale: string | null | undefined): CountryCode {
  const match = (locale ?? "").match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
  const candidate = match?.[1]?.toUpperCase();
  return candidate && listed.has(candidate) ? (candidate as CountryCode) : DEFAULT_PHONE_REGION;
}
