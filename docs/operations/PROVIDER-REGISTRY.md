# Provider and Ownership Registry

This file records **what external systems Mad Buddy depends on and who must control them**. It deliberately does not contain passwords, private keys, recovery codes, card numbers, database passwords, or API secret values.

The founder/operator must fill the `OWNER TO FILL` fields after checking each provider dashboard.

## Ownership standard

Every production-critical provider should have:

- a named primary owner,
- at least one recovery path that does not depend on a single device,
- 2FA enabled,
- recovery codes stored in the Mad Buddy private vault,
- billing/renewal ownership recorded,
- a documented process to revoke a developer,
- a backup trusted operator where the provider permits it.

## Registry

| Provider | Mad Buddy resource | Known technical authority | Owner / recovery information to fill |
| --- | --- | --- | --- |
| **GitHub** | `Goasante/mad-buddy` | Public repository; default branch `main` | Account owner, backup recovery, 2FA method, trusted collaborators |
| **Vercel** | Project `mad-buddy` | Production domain `https://mad-buddy.com`; Next.js deployment | Team/account owner, billing owner, backup admin, 2FA/recovery |
| **Supabase Production** | Production project | Project ref `cabkhxxnrybzhkbtoiiz`; canonical Auth/Postgres/Storage/Realtime | Organization/project owner, billing plan, region, backup/PITR status, recovery |
| **Supabase Staging** | Synthetic-data staging project | Project ref `ivaydmciwmjdjsrovbqb`; never contains human data by design | Owner, plan, reset authority, backup/recovery expectations |
| **Cloudflare** | DNS / Turnstile / possible registrar controls | `mad-buddy.com`; Turnstile used by signup/recovery | Account owner, registrar, billing/renewal, domain lock, 2FA, recovery |
| **Paystack** | Merchant + Mad Buddy Access subscription product | Current product authority is `lib/access/product.ts`; server owns price and plan selection | Merchant owner, settlement account owner, live/test access, dispute/refund operator, 2FA/recovery |
| **Google Cloud / OAuth** | Google sign-in provider configuration | Web Google OAuth is routed through Supabase; native clients require platform-specific setup | Cloud project owner, OAuth client owners, consent-screen owner, recovery |
| **Firebase** | FCM/native push | Server uses `FIREBASE_SERVICE_ACCOUNT_BASE64`; Android/iOS client config files are build inputs | Firebase project owner, service-account rotation authority, backup admin |
| **Google Play Console** | Android app | Application id `com.madbuddy.app` | Account owner, Play App Signing status, upload-key owner, backup admin, recovery |
| **Apple Developer / App Store Connect** | iOS app | Bundle id `com.madbuddy.app` | Team ID, Account Holder, Admin backup, signing/APNs owners, recovery |
| **Google Analytics** | GA4 | Client uses `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Property owner, stream id, backup administrator, retention settings |
| **Domain registrar** | `mad-buddy.com` | May or may not be the same account as Cloudflare DNS; verify | Registrar name, registrant account, auto-renewal, payment method owner, recovery |
| **Password manager / vault** | Mad Buddy production vault | Must remain outside Git | Vault product, vault owner, emergency recovery process, backup trusted person |

## Required founder fields

For each row above, record privately or in the non-secret columns of this document:

- **Account / organization name**
- **Login email** (safe to document only if the owner approves it as operational metadata)
- **Primary owner**
- **Backup owner/admin**
- **Billing owner**
- **2FA method** (do not record seed/secret)
- **Recovery-code location** (vault path only)
- **Renewal date / billing cadence** where relevant
- **Support contract/plan** if relevant
- **Last ownership review date**

## Production vs staging separation

Production and staging must not share destructive operational state.

- Production Supabase ref: `cabkhxxnrybzhkbtoiiz`
- Staging Supabase ref: `ivaydmciwmjdjsrovbqb`
- Staging is synthetic-data-only by design.
- Before any remote Supabase reset/push/seed, re-read the linked project ref immediately before the command.

Do not rely on a worktree name, terminal title, `.env` filename, or memory to infer the target.

## Access removal checklist for a departing developer

When a developer no longer needs production access:

1. Remove GitHub repository/org access as appropriate.
2. Remove Vercel team/project access.
3. Remove Supabase org/project access.
4. Remove Cloudflare access.
5. Remove Paystack access.
6. Remove Google Cloud/Firebase access.
7. Remove Play Console / App Store Connect access.
8. Remove password-vault shared-item access.
9. Rotate any shared credential the person could copy (avoid shared credentials in the first place where possible).
10. Review provider audit logs for unusual access around departure.

## Provider-dashboard checks that code cannot prove

The repository cannot prove current provider settings such as:

- whether Supabase backups/PITR are enabled,
- whether Vercel/Cloudflare/Supabase spend alerts are configured,
- whether the domain auto-renews,
- whether Paystack settlement/dispute alerts are enabled,
- whether Apple/Google recovery paths are current,
- whether 2FA is enabled for every administrator,
- whether provider billing cards are valid.

These are owner/operator responsibilities and should be reviewed monthly and after any ownership, billing, domain, authentication, or payment change.
