# Deployment Checklist

This checklist reflects the current Mad Buddy product and should be read together with `docs/operations/DEPLOYMENT-RUNBOOK.md`.

## Core Production Environment

Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Operator-only/local migration credential:

- `SUPABASE_DB_PASSWORD` — required by the Supabase CLI for linked migration operations; store in the private vault/local operator environment, not client code.

App / administration:

- `NEXT_PUBLIC_APP_URL`
- `ADMIN_EMAILS`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Schedulers:

- `CRON_DB_SECRET` — Supabase `pg_cron` primary scheduler credential
- `CRON_SECRET` — GitHub Actions backstop credential

Do not reuse the same value for both schedulers.

## Mad Buddy Access / Paystack

Current consumer product authority is **Mad Buddy Access**. The retired Buddy Plus / Buddy Pro plan codes are not required for the current product.

Provider transport values required by the current live checkout/webhook path:

- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_WEBHOOK_SECRET`

Current product price/plan authority is server-owned in `lib/access/product.ts`.

Optional overrides (primarily staging/test; review deliberately before using in Production):

- `MAD_BUDDY_ACCESS_AMOUNT_MINOR`
- `MAD_BUDDY_ACCESS_PLAN_CODE`

Legacy compatibility only — not current product authority:

- `PAYSTACK_BUDDY_PLUS_PLAN_CODE`
- `PAYSTACK_BUDDY_PRO_PLAN_CODE`

Paystack webhook endpoint:

- `/api/paystack/webhook`

Checkout callback:

- `/subscription-success?provider=paystack`

Relevant provider events include:

- `charge.success`
- `subscription.create`
- `subscription.enable`
- `subscription.disable`
- `subscription.not_renew`
- `invoice.payment_failed`
- `invoice.update`

## Push / Contact Discovery

Web Push, when enabled:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

The public and server VAPID public key values must match.

Native push, when enabled:

- `FIREBASE_SERVICE_ACCOUNT_BASE64` — server-only Firebase service-account JSON encoded as base64; treat as a high-impact secret.

Contact matching, when enabled:

- `CONTACT_MATCH_HMAC_SECRET`
- future rotated versions use `CONTACT_MATCH_HMAC_SECRET_V2`, `..._V3`, etc.

Mobile/API origin override, only when needed:

- `MOBILE_ALLOWED_ORIGIN`

## Vercel Settings

- Build command: `npm run build`
- Install command: `npm install`
- Framework preset: Next.js
- Node runtime: default Vercel Node runtime

The production app URL must not resolve to localhost.

## Production Safety Checks

- `/safety` must have `ADMIN_EMAILS` configured.
- `SUPABASE_SERVICE_ROLE_KEY`, Firebase Admin credentials, provider secrets and signing material must remain server/operator-only.
- `/api/health` should return `200`.
- `/api/health/readiness` should return `200` only when its required runtime configuration and database reachability checks pass.
- Paystack webhook endpoint must be configured at `/api/paystack/webhook`.
- Cloudflare Turnstile must allow the production hostname and supported native/local origins used by the app.
- Supabase Auth redirect URLs must include the production callback (`https://mad-buddy.com/auth/callback`) plus explicitly approved staging/native callbacks.
- Complete every provider check in `docs/security-provider-operations.md` and `docs/operations/PROVIDER-REGISTRY.md`.
- Verify the scheduler credentials independently; a working GitHub backstop does not prove the Supabase primary scheduler is configured.
- Verify the exact Supabase project ref immediately before migrations or any destructive operation.

## Final Commands

Before release:

```bash
npm run preflight:production
npm run test:release
npm run lint
npm run typecheck
npm run build
```

When billing is in scope:

```bash
npm run preflight:paystack
```

Apply migrations only after explicit target verification and according to `docs/operations/DATABASE-RUNBOOK.md`; do not run a blind `supabase db push` against an unverified linked project.
