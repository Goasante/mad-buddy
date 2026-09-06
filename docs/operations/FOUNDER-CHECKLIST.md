# Founder Checklist — Facts Only the Owner Can Supply

This checklist exists because source code cannot prove who owns external accounts, who pays for them, where recovery codes are stored, or whether provider dashboards are configured correctly.

**Do not paste passwords, API secret values, private keys, recovery codes, card numbers, or database credentials into this document.** Record only ownership/status and the vault path where the real secret is stored.

## Private vault

- [ ] Choose the Mad Buddy private password-manager vault.
- [ ] Record vault owner.
- [ ] Configure account recovery / emergency access.
- [ ] Add a second trusted recovery path where appropriate.
- [ ] Store recovery codes separately from the device used for 2FA.
- [ ] Confirm no production secret is stored only in a local `.env` file on one laptop.

Recommended item format:

```text
Credential: PAYSTACK_SECRET_KEY
Environment: Production
Stored at: Mad Buddy Vault → Paystack → Production API
Owner: <name>
Last rotated: <date>
Value: NEVER COPY HERE
```

## GitHub

- [ ] Confirm the owner account for `Goasante/mad-buddy`.
- [ ] Confirm 2FA and recovery are working.
- [ ] Review current collaborators/apps with repository access.
- [ ] Decide who should be allowed to merge to `main` when developers join.
- [ ] Approve branch/ruleset protection before onboarding external developers.

## Domain / Cloudflare

- [ ] Confirm where `mad-buddy.com` is registered.
- [ ] Confirm registrant/login account.
- [ ] Confirm auto-renewal is enabled.
- [ ] Confirm billing method owner.
- [ ] Confirm domain-lock / transfer protection.
- [ ] Confirm Cloudflare account owner and backup admin.
- [ ] Confirm 2FA/recovery.
- [ ] Confirm Turnstile production site exists and intended hostnames are allowed.

## Vercel

- [ ] Confirm team/account that owns project `mad-buddy`.
- [ ] Confirm billing plan and billing owner.
- [ ] Confirm backup admin.
- [ ] Confirm production environment values exist for all current required server/public variables.
- [ ] Confirm preview/staging scopes do not accidentally reuse Production-only secrets when separation is available.
- [ ] Configure usage/spend alerts and route them to more than one trusted operator if possible.

## Supabase Production

- [ ] Confirm Production project ref is `cabkhxxnrybzhkbtoiiz`.
- [ ] Confirm organization/project owner.
- [ ] Record region and plan.
- [ ] Check managed backups / PITR status and retention.
- [ ] Confirm latest backup health.
- [ ] Plan and document a restore drill into an isolated non-production project.
- [ ] Confirm Auth site URL and allowed redirect URLs.
- [ ] Confirm email confirmation policy.
- [ ] Confirm refresh-token rotation/reuse-detection settings.
- [ ] Confirm service-role and DB credentials are stored in the private vault.
- [ ] Confirm Supabase Vault contains the primary cron endpoint/credential where expected.

## Supabase Staging

- [ ] Confirm staging ref is `ivaydmciwmjdjsrovbqb`.
- [ ] Confirm it remains synthetic-data-only.
- [ ] Confirm no human accounts/data have been introduced.
- [ ] Confirm staging keys are not mistaken for Production keys in Vercel/local envs.

## Paystack

- [ ] Confirm merchant account owner.
- [ ] Confirm settlement bank/account ownership.
- [ ] Confirm live/test mode access is understood.
- [ ] Confirm Mad Buddy Access plan in Paystack matches current source authority.
- [ ] Confirm webhook endpoint/configuration.
- [ ] Confirm refund/dispute permissions and who is responsible.
- [ ] Confirm settlement, failed-charge, dispute, refund, and webhook alerts.
- [ ] Store live secret/webhook credentials in the private vault.

## Google / Firebase

- [ ] Confirm Google Cloud project owner for OAuth.
- [ ] Confirm Supabase Google OAuth provider configuration.
- [ ] Confirm Firebase project owner and backup admin.
- [ ] Confirm who may create/rotate Firebase service-account credentials.
- [ ] Confirm Android app registration and SHA fingerprints.
- [ ] Confirm iOS app registration when native setup reaches that stage.
- [ ] Store service-account / OAuth private credentials in the vault, never Git.

## Google Play Console / Android

- [ ] Confirm Play Console account owner.
- [ ] Confirm app `com.madbuddy.app` exists or record that it has not yet been created.
- [ ] Confirm whether Play App Signing is enabled.
- [ ] Identify the upload/release keystore owner.
- [ ] Back up the keystore outside the development laptop.
- [ ] Store keystore passwords/alias metadata in the private vault.
- [ ] Confirm version/release ownership process.

## Apple Developer / App Store Connect

- [ ] Confirm Apple Developer membership/account exists or record that it does not yet exist.
- [ ] Record Team ID.
- [ ] Record Account Holder and backup Admin.
- [ ] Confirm bundle id `com.madbuddy.app` registration.
- [ ] Confirm APNs configuration owner.
- [ ] Store certificate/private-key backups and recovery information in the private vault.

## Analytics

- [ ] Confirm GA4 property and web stream.
- [ ] Record property owner and backup admin.
- [ ] Confirm data retention settings.
- [ ] Confirm key product events that leadership relies on.

## Operational recovery

- [ ] Write down who should be contacted if the domain is compromised.
- [ ] Write down who should be contacted if Supabase/Production database access is lost.
- [ ] Write down who owns payment incident response.
- [ ] Write down who owns account-security incidents.
- [ ] Confirm at least one person other than the primary owner can recover critical provider access if the business requires continuity.

## Historical-secret audit

- [ ] Run the repository's full history scanner from a trusted local clone:

```bash
node scripts/security/scan-secrets.mjs --history
```

- [ ] For every genuine finding: rotate/revoke first, then clean up history/exposure.
- [ ] Record rotation date and affected provider without recording the old/new value.

## Review cadence

Repeat this checklist:

- before inviting a new developer with provider access,
- after a developer/operator leaves,
- after any credential incident,
- after domain/billing/payment/authentication changes,
- before first App Store / Play Store production release,
- at least quarterly during active operation.
