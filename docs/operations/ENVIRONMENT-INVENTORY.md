# Environment and Secret Inventory

This is the operational inventory of Mad Buddy configuration. It records **names, purpose, scope, and storage class only**. Never put a real secret value in this file.

## Classification

- **PUBLIC** — intentionally shipped to browser/native clients.
- **SERVER SECRET** — may exist only in server/provider secret stores.
- **OPERATOR SECRET** — used by CLI/release/operator tooling, never by clients.
- **PROVIDER DASHBOARD** — configured in an external provider rather than an application env var.
- **AUTOMATIC** — supplied by Vercel/Node/build tooling.
- **LEGACY / REVIEW** — still referenced somewhere but not current product authority.

## Web / server runtime

| Variable | Class | Purpose | Expected storage / notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | Supabase project URL | Vercel env; local `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | Legacy/public Supabase browser key | Vercel/local; publishable key may supersede it |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | PUBLIC | Supabase publishable browser key | Vercel/local |
| `SUPABASE_SERVICE_ROLE_KEY` | SERVER SECRET | Privileged server/database operations | Vercel server env / private vault; never browser/native |
| `SUPABASE_JWT_SECRET` | SERVER SECRET | Legacy/verification-sensitive Supabase JWT config where used | Private vault; review continued necessity before sharing |
| `SUPABASE_DB_PASSWORD` | OPERATOR SECRET | Supabase CLI / direct database operator access | Private vault / local operator env only |
| `NEXT_PUBLIC_APP_URL` | PUBLIC | Canonical application URL | Production should resolve to `https://mad-buddy.com` |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | PUBLIC | GA4 measurement id | Vercel/public config |
| `ADMIN_EMAILS` | SERVER CONFIG | Coarse admin-email allowlist used by server code | Vercel env; value itself is not a cryptographic secret but controls privilege and should be change-controlled |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | PUBLIC | Cloudflare Turnstile site key | Vercel/public config |
| `TURNSTILE_SECRET_KEY` | SERVER SECRET | Turnstile verification | Vercel server env / vault |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | PUBLIC | Browser push subscription public key | Vercel/public config |
| `VAPID_PUBLIC_KEY` | SERVER CONFIG | Server copy of VAPID public key | Vercel server env; must match public key |
| `VAPID_PRIVATE_KEY` | SERVER SECRET | Web Push signing | Vercel server env / vault |
| `VAPID_SUBJECT` | SERVER CONFIG | VAPID contact subject (`mailto:` or URL) | Vercel env |
| `CONTACT_MATCH_HMAC_SECRET` | SERVER SECRET | Keyed phone/contact matching HMAC | Vercel server env / vault; minimum 32 chars |
| `CONTACT_MATCH_HMAC_SECRET_V2`, `..._V3`, etc. | SERVER SECRET | Versioned rotated contact-match keys | Add only as rotations occur; keep old versions while stored identifiers still need them |
| `CRON_SECRET` | SERVER SECRET | GitHub Actions scheduler backstop credential | GitHub Actions secret + server env; independent from DB scheduler |
| `CRON_DB_SECRET` | SERVER SECRET | Supabase `pg_cron` primary scheduler credential | Vercel server env + Supabase Vault; independent from GitHub scheduler |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | SERVER SECRET | Base64 Firebase service-account JSON for native push (FCM/APNs) | Vercel server env / vault; contains a private key |
| `MOBILE_ALLOWED_ORIGIN` | SERVER CONFIG | Optional extra CORS origin for native/mobile development | Vercel/local only when required |

## Mad Buddy Access / Paystack

Current consumer authority is `lib/access/product.ts` and `docs/product/MONETIZATION-ACCESS-MODEL.md`.

| Variable | Class | Purpose | Status |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | PUBLIC | Paystack client/public key where browser checkout needs it | Current Paystack integration dependency |
| `PAYSTACK_SECRET_KEY` | SERVER SECRET | Paystack API verification/checkout | Vault + Vercel server env |
| `PAYSTACK_WEBHOOK_SECRET` | SERVER SECRET | Webhook verification override; falls back to Paystack secret in current legacy config helper | Prefer explicit separate value where supported |
| `MAD_BUDDY_ACCESS_AMOUNT_MINOR` | SERVER CONFIG | Test/staging override for current Access price | Optional; source default is current production authority |
| `MAD_BUDDY_ACCESS_PLAN_CODE` | SERVER CONFIG | Test/staging override for current Access Paystack plan | Optional; source default is current production authority |
| `PAYSTACK_BUDDY_PLUS_PLAN_CODE` | LEGACY / REVIEW | Old Buddy Plus plan code | Retired product model; still referenced by legacy readiness/config docs and must be reconciled |
| `PAYSTACK_BUDDY_PRO_PLAN_CODE` | LEGACY / REVIEW | Old Buddy Pro plan code | Retired product model; still referenced by legacy readiness/config docs and must be reconciled |

**Current source authority:** Mad Buddy Access is one monthly product. The old Plus/Pro ladder is not the current consumer model. Do not restore old billing simply because a legacy env name remains in source or docs.

## Native bundle (`mobile/`)

Everything under `VITE_*` is considered client-visible. Never place privileged credentials there.

| Variable | Class | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | PUBLIC | Deployed web API base URL used by bundled native SPA |
| `VITE_SUPABASE_URL` | PUBLIC | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | PUBLIC | Supabase anon/publishable client key |
| `VITE_TURNSTILE_SITE_KEY` | PUBLIC | Turnstile site key for native WebView origin |

The native bundle must never contain `SUPABASE_SERVICE_ROLE_KEY`, Paystack secret keys, Firebase service-account JSON, VAPID private keys, database passwords, or signing passwords.

## Android signing and Firebase files

These are files/credentials rather than ordinary env vars:

| Item | Class | Storage |
| --- | --- | --- |
| Android release keystore (`*.jks` / `*.keystore`) | OPERATOR SECRET | Private vault / protected offline backup; gitignored |
| `android/keystore.properties` | OPERATOR SECRET | Local machine only; contains keystore path/passwords; gitignored |
| `android/app/google-services.json` | SENSITIVE CLIENT CONFIG | Local/CI build input; root `.gitignore` excludes it |
| Play Console upload/app-signing recovery material | OPERATOR SECRET | Private vault / Play Console ownership record |

## iOS signing and Firebase files

| Item | Class | Storage |
| --- | --- | --- |
| Distribution certificates/private keys (`.p12`) | OPERATOR SECRET | Private vault / Keychain; never Git |
| Provisioning profiles (`.mobileprovision`) | SENSITIVE OPERATOR FILE | Apple developer tooling / vault backup; never Git |
| `ios/App/App/GoogleService-Info.plist` | SENSITIVE CLIENT CONFIG | Local/CI build input; root `.gitignore` excludes it |
| APNs keys/certificates | OPERATOR SECRET | Apple Developer account + vault |
| Apple recovery codes / account recovery | OPERATOR SECRET | Vault; owner + backup operator |

## Provider/dashboard configuration that is not represented by an application secret

These must be recorded in `PROVIDER-REGISTRY.md` and verified in the provider UI:

- Supabase Auth providers, redirect URLs, token lifetime/rotation, backups/PITR, plan and region.
- Google OAuth web/Android/iOS client registrations and Android SHA fingerprints.
- Firebase project, FCM/APNs configuration and device-platform app registrations.
- Cloudflare DNS/registrar, Turnstile allowed hostnames, account recovery and billing.
- Vercel project/team ownership, environment scopes, custom domains, spend/billing alerts.
- Paystack merchant/settlement ownership, plan record, webhook configuration and dispute/refund access.
- Apple Developer / App Store Connect ownership and signing configuration.
- Google Play Console ownership and Play App Signing.
- GA4 property/stream ownership and backup administrator.

## Automatic environment variables

The application also consumes platform/runtime variables supplied automatically, including Vercel deployment/build identifiers such as `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_GIT_COMMIT_SHA`, plus Node/Next runtime variables such as `NODE_ENV` and `NEXT_RUNTIME`. These are not founder-managed secrets.

## Known inventory gaps to reconcile

At creation of this file, root `.env.example` does not yet enumerate all current variables. Specifically, newer code references at least `CRON_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, `MOBILE_ALLOWED_ORIGIN`, and current Mad Buddy Access override names. A later reconciliation commit should update `.env.example` after legacy Paystack checks are cleaned up.

## Rotation rule

When a server/operator secret changes, record only:

- credential name,
- provider,
- environment,
- vault item path,
- last rotation date,
- person/service responsible,
- whether dependants were restarted/redeployed,
- verification result.

Never record the secret value here.
