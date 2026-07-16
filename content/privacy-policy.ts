export { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "16 July 2026";
export const PRIVACY_POLICY_LAST_UPDATED = "16 July 2026";

export const legalContactPlaceholders = {
  // TODO(legal): Replace every placeholder before production launch.
  companyName: "[LEGAL COMPANY NAME]",
  businessAddress: "[REGISTERED BUSINESS ADDRESS]",
  privacyEmail: "[PRIVACY EMAIL ADDRESS]",
  supportEmail: "[SUPPORT EMAIL ADDRESS]"
} as const;

// DRAFT STATUS: This policy describes the application's actual, verified
// behavior (location handling, sharing rules, deletion) as confirmed in the
// July 2026 application audit. It has NOT yet been reviewed by legal counsel.
// The bracketed entity placeholders above must be filled in, and the whole
// document must be approved by a lawyer, before public launch.
export const privacyPolicyMarkdown = `
# Mad Buddy Privacy Policy

## Draft status

**This is a draft.** It accurately describes how Mad Buddy handles your data today, but it has not yet been reviewed by legal counsel and the operating company details below are placeholders. It is published now because we believe an honest draft is better than an empty page.

## Introduction

Mad Buddy ("we", "us") is a private social proximity app operated by ${legalContactPlaceholders.companyName}, ${legalContactPlaceholders.businessAddress}. It lets friends you have mutually approved ("Muddies") know roughly when you are nearby — without ever sharing your exact location. This policy explains what we collect, why, what your friends can and cannot see, and what control you have.

## What we collect

* **Account information** — your email address, display name, username, and password (stored as a hash by our authentication provider; we never see your plain-text password).
* **Profile information you choose to add** — a bio, a mood status, and a profile photo.
* **A single location signal** — when your glow is on, your device sends your current coordinates over an encrypted connection. We store only your most recent signal: each update overwrites the previous one. We do not keep a location history.
* **Derived proximity signals** — short-lived records of which proximity tier (Very close, Nearby, Around you) applied between you and a Muddy, kept for the app's recent-activity features and designed to expire after 15 minutes.
* **Notifications and social activity** — friend requests, waves, meet-up pings, and in-app notifications you send or receive.
* **Billing information** — if you subscribe, our payment provider (Paystack) processes your payment. We store a reference to your subscription status and plan, never your card number.

## How location actually works

* Location is collected only in the foreground, when the app is open and your glow is on. There is no background tracking.
* Your raw coordinates are processed on our servers only. They are converted into a broad proximity tier before anything is shared.
* **Your Muddies never receive your coordinates, a map position, your exact distance, your direction of travel, or your street address.** Our server code enforces this with an automated check that rejects any response containing location-precise fields.
* Turning on Ghost Mode removes you from every Muddy's nearby view immediately. This is enforced on the server, not just hidden in the interface.

## What your Muddies can see

* A privacy-safe proximity tier: Very close, Nearby, or Around you.
* Your chosen display name, username, profile photo, bio, and mood status.
* Whether you have chosen to be visible right now.

## What your Muddies can never see

* Exact coordinates or a map pin.
* Exact distance or direction.
* Street addresses.
* Any location history.

## Who can see you at all

* Only people you have both approved as Muddies can ever appear in each other's nearby view. There is no public discovery of your location signal.
* Blocking someone removes proximity visibility and interaction in both directions.
* Removing a Muddy ends their access to your proximity signal.

## How long we keep data

* **Location signal**: only the most recent one; each update overwrites the last.
* **Proximity records**: designed to expire after 15 minutes.
* **Account, profile, and social data**: kept while your account exists.
* **After account deletion**: see below.

## Account deletion

When you delete your account from Settings, we delete your profile, your stored location signal, your proximity records, your friendships and requests, your notifications, your circles, your preferences, your uploaded photos, and your authentication record. We retain a minimal audit entry (a "Deleted User" label and a billing reference, where a paid subscription existed) for fraud prevention and financial record-keeping, and reports you filed or that were filed about you are anonymized rather than deleted so that our safety team's decisions remain accountable.

## Payments

Subscriptions are processed by Paystack. Payment webhooks from Paystack are cryptographically verified before we act on them. We never store your full card details.

## Logging and analytics

Our server logs record request metadata (route, status, timing, error category) for reliability and abuse prevention. Our logging layer is built to refuse location fields — coordinates are not written to logs. We do not currently use third-party analytics.

## Your rights and choices

* Pause your visibility or turn on Ghost Mode at any time.
* Export a copy of your account data from Settings.
* Delete your account from Settings at any time.
* Contact us about your data at ${legalContactPlaceholders.privacyEmail}.

## Changes to this policy

We will update the "Last updated" date above when this policy changes, and material changes will be announced in the app before they take effect.

## Contact

Questions about privacy: ${legalContactPlaceholders.privacyEmail}. General support: ${legalContactPlaceholders.supportEmail}.
`;
