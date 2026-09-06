# Founder Checklist — Facts Only the Owner Can Supply

This checklist exists because source code cannot prove who owns external accounts, who pays for them, where recovery codes are stored, or whether provider dashboards are configured correctly.

**Do not paste passwords, API secret values, private keys, recovery codes, card numbers, or database credentials into this document.** Record only ownership/status and the vault path where the real secret is stored.

## Founder-attested facts — 2026-09-06

The following facts have now been supplied by the founder. Because the repository is public, login email addresses are intentionally not repeated here; store login identity in the private provider/vault record.

- **Domain registrar:** currently unknown/forgotten. Recovery task remains open.
- **Cloudflare:** founder-controlled account.
- **Vercel:** founder-owned personal project/account; currently on the free plan.
- **Supabase Production:** founder-controlled personal account/project; founder reports being the current owner/admin.
- **Paystack:** merchant/business and settlement account are under founder/business control.
- **Google Play Console:** not yet established.
- **Apple Developer / App Store Connect:** not yet established.

These facts close ownership-identification questions only. They do **not** prove 2FA, recovery, backups, provider alerting, billing renewal, webhook settings, Auth settings, or signing readiness. Those remain separate checklist items below.

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

- [ ] **OPEN — recover registrar:** confirm where `mad-buddy.com` is registered. Founder currently does not remember the registrar/company.
- [ ] Confirm registrant/login account once registrar is recovered.
- [ ] Confirm auto-renewal is enabled.
- [ ] Confirm billing method owner.
- [ ] Confirm domain-lock / transfer protection.
- [x] Confirm Cloudflare account owner — founder-controlled.
- [ ] Confirm Cloudflare backup admin.
- [ ] Confirm 2FA/recovery.
- [ ] Confirm Turnstile production site exists and intended hostnames are allowed.

Registrar recovery routes, in preferred order:

1. Search original purchase/renewal email for `mad-buddy.com`.
2. Search card/mobile-money/bank history for the domain purchase/renewal merchant.
3. Check Cloudflare domain/registrar UI to see whether the domain is registered there or only using Cloudflare DNS.
4. Use ICANN/RDAP to identify the current registrar of record. Note that the accredited registrar shown by RDAP may be the backend for a reseller brand.
5. Once recovered, store registrar login identity, renewal date and recovery information in the private vault/provider record — not in this public file.

## Vercel

- [x] Confirm team/account that owns project `mad-buddy` — founder-owned personal account/project.
- [x] Confirm current billing plan — free plan at founder attestation date.
- [ ] Confirm backup admin/recovery path.
- [ ] Confirm production environment values exist for all current required server/public variables.
- [ ] Confirm preview/staging scopes do not accidentally reuse Production-only secrets when separation is available.
- [ ] Configure usage/spend alerts if/when paid usage begins and route them to more than one trusted operator if possible.

## Supabase Production

- [x] Confirm Production project ref is `cabkhxxnrybzhkbtoiiz`.
- [x] Confirm organization/project owner — founder-controlled; founder reports being current owner/admin.
- [ ] Confirm whether any additional organization/project administrators currently exist.
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

- [x] Confirm staging ref is `ivaydmciwmjdjsrovbqb`.
- [ ] Confirm staging owner/access list.
- [ ] Confirm it remains synthetic-data-only.
- [ ] Confirm no human accounts/data have been introduced.
- [ ] Confirm staging keys are not mistaken for Production keys in Vercel/local envs.

## Paystack

- [x] Confirm merchant account owner/control — founder/business controlled.
- [x] Confirm settlement bank/account ownership/control — founder/business controlled.
- [ ] Confirm live/test mode access is understood and clearly separated.
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

- [x] Record current status — no Play Console account/app ownership established yet.
- [ ] Before Android store release, create/confirm the Play Console owner account.
- [ ] Create/confirm app `com.madbuddy.app`.
- [ ] Enable/confirm Play App Signing.
- [ ] Identify the upload/release keystore owner.
- [ ] Back up the keystore outside the development laptop.
- [ ] Store keystore passwords/alias metadata in the private vault.
- [ ] Confirm version/release ownership process.

## Apple Developer / App Store Connect

- [x] Record current status — no Apple Developer/App Store Connect account established yet.
- [ ] Before iOS distribution, create/confirm Apple Developer membership/account.
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

Preferred repository audit path:

- [ ] In GitHub Actions, run **Secret history audit** (`.github/workflows/security-history-audit.yml`) manually. It checks out full history and runs the scanner without production credentials.
- [ ] Confirm the workflow proves the checkout is not shallow.
- [ ] If GitHub Actions is unavailable, run from a trusted full local clone:

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
