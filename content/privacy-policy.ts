export { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "23 July 2026";
export const PRIVACY_POLICY_LAST_UPDATED = "30 August 2026";

export const legalContact = {
  companyName: "Godfred Ofosu Asante",
  businessAddress: "Ashongman Estate",
  privacyEmail: "godfredasante004@gmail.com",
  supportEmail: "godfredasante004@gmail.com"
} as const;

/**
 * SUBSTANTIVE POLICY CHANGE — OWNER APPROVED 30 AUGUST 2026.
 *
 * The policy now distinguishes Muddy proximity from deliberately enabled Linkr
 * discovery. This is not a styling-only edit and should remain visible in the
 * release review. The approved product truth is that neither mode exposes
 * exact GPS coordinates, street location, exact numerical distance, a live map
 * position, or location history to the other user.
 */
export const privacyPolicyMarkdown = `
# Mad Buddy Privacy Policy

## Introduction

Mad Buddy ("we", "us") is a private social proximity app operated by ${legalContact.companyName}, ${legalContact.businessAddress}. It helps mutually approved friends ("Muddies") notice roughly when they are nearby and also lets you deliberately enable Linkr when you want to discover someone new. In both cases, the ordinary proximity experience is designed not to reveal your exact location to another user. This policy explains what we collect, why, what other people can and cannot see, and what control you have.

## What we collect

* **Account information:** your email address, display name, username, and password (stored as a hash by our authentication provider; we never see your plain-text password).
* **Profile information you choose to add:** a bio, a mood status, and a profile photo.
* **A single location signal:** when your glow is on, your device sends your current coordinates over an encrypted connection. We store only your most recent signal: each update overwrites the previous one. We do not keep a location history.
* **Derived proximity signals:** short-lived records of broad proximity used by Mad Buddy's proximity features, designed to expire after 15 minutes.
* **Notifications and social activity:** friend requests, waves, meet-up pings, and in-app notifications you send or receive.
* **Billing information:** if you subscribe, our payment provider (Paystack) processes your payment. We store a reference to your subscription status and plan, never your card number.

## How location actually works

* Location is collected only in the foreground, when the app is open and your glow is on. There is no background tracking.
* Your raw coordinates are processed on our servers only. They are converted into broad proximity information before anything is shared with another user.
* **Other users do not receive your coordinates, a live map position, your exact numerical distance, your direction of travel, your street address, or your location history through Mad Buddy's ordinary proximity experience.**
* Turning on Ghost Mode removes you from nearby visibility immediately. This is enforced on the server, not just hidden in the interface.

## Muddy proximity

* Muddies are people you have mutually approved.
* Approved Muddies may receive privacy-preserving proximity information according to your visibility settings.
* They may see a broad sense that you are nearby together with the profile information you have chosen to make available in that relationship.
* Removing a Muddy or blocking someone ends their Muddy proximity access.

## Linkr discovery

* Linkr is different from Muddy proximity. It is a discovery mode you deliberately enable when you want to meet someone new.
* While you have Linkr enabled, eligible people who are not yet Muddies may receive a privacy-safe approximate proximity signal as part of discovery.
* Linkr does not give another person your exact GPS coordinates, street address or street-level location, exact numerical distance, live map position, direction of travel, or location history.
* A Linkr discovery does not make someone a Muddy automatically. A continuing connection still requires mutual choice.
* When you stop your Linkr session, Linkr discovery stops.

## What other users can never see through proximity

* Exact GPS coordinates.
* A live map position or map pin showing where you are.
* Exact numerical distance or direction of travel.
* Street addresses or street-level location.
* Location history.

## Who can see proximity information

* For Muddy proximity, only people you have mutually approved as Muddies can receive your Muddy proximity signal, subject to your visibility settings.
* For Linkr, eligible people who are not yet Muddies may receive a privacy-safe approximate proximity signal only while you have deliberately enabled Linkr discovery.
* Blocking someone removes proximity visibility and interaction in both directions.
* Removing a Muddy ends their Muddy proximity access.

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

Our server logs record request metadata (route, status, timing, error category) for reliability and abuse prevention. Our logging layer is built to refuse location fields, so coordinates are not written to logs. We do not currently use third-party analytics.

## Your rights and choices

* Pause your visibility or turn on Ghost Mode at any time.
* Stop a Linkr discovery session when you no longer want discovery active.
* Export a copy of your account data from Settings.
* Delete your account from Settings at any time.
* Contact us about your data at ${legalContact.privacyEmail}.

## Changes to this policy

We will update the "Last updated" date above when this policy changes, and material changes will be announced in the app before they take effect.

## Contact

Questions about privacy: ${legalContact.privacyEmail}. General support: ${legalContact.supportEmail}.
`;
