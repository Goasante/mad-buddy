import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";

import { DEFAULT_PHONE_REGION } from "@/lib/contacts/phone-normalization";

/**
 * Country options shared by Settings and Find Your Muddies.
 *
 * Earlier this was a hand-written ten-country shortlist. That was fine for
 * typing +international numbers, but not for CONTACT matching: an Australian
 * contact saved as 04… needs an AU parsing region even though Australia was
 * not in that shortlist. Every libphonenumber-supported country is therefore
 * available here, with Mad Buddy's main/current markets sorted first.
 */
const PRIORITY_REGIONS: readonly CountryCode[] = [
  "GH",
  "NG",
  "GB",
  "US",
  "CA",
  "ZA",
  "KE",
  "DE",
  "FR",
  "IN"
];

const FRIENDLY_NAMES: Partial<Record<CountryCode, string>> = {
  GH: "Ghana",
  NG: "Nigeria",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  ZA: "South Africa",
  KE: "Kenya",
  DE: "Germany",
  FR: "France",
  IN: "India"
};

const priorityRank = new Map(PRIORITY_REGIONS.map((code, index) => [code, index]));

export const CONTACT_REGIONS = getCountries()
  .sort((a, b) => {
    const aRank = priorityRank.get(a);
    const bRank = priorityRank.get(b);
    if (aRank !== undefined || bRank !== undefined) {
      return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
    }
    return a.localeCompare(b);
  })
  .map((code) => ({
    code,
    label: `${FRIENDLY_NAMES[code] ?? code} (+${getCountryCallingCode(code)})`
  })) satisfies ReadonlyArray<{ code: CountryCode; label: string }>;

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
  const candidate = match?.[1]?.toUpperCase() as CountryCode | undefined;
  return candidate && CONTACT_REGIONS.some((entry) => entry.code === candidate)
    ? candidate
    : DEFAULT_PHONE_REGION;
}
