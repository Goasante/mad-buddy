# Deployment Checklist

## Required Production Environment Variables

Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD`, needed locally by the Supabase CLI when applying migrations

App:

- `NEXT_PUBLIC_APP_URL`
- `ADMIN_EMAILS`

Paystack, required before live billing:

- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_WEBHOOK_SECRET`
- `PAYSTACK_BUDDY_PLUS_PLAN_CODE`
- `PAYSTACK_BUDDY_PRO_PLAN_CODE`

## Vercel Settings

- Build command: `npm run build`
- Install command: `npm install`
- Framework preset: Next.js
- Node runtime: default Vercel Node runtime

## Production Safety Checks

- `/safety` must have `ADMIN_EMAILS` configured.
- The local premium tester is hidden when `NODE_ENV=production`.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server-only modules and API/server actions.
- `/api/health` should return `200`.
- `/api/health/readiness` should return `200` only after required production env is configured.
- Paystack webhook endpoint should be `/api/paystack/webhook`.
- Paystack callback URL should be `/subscription-success`.
- Paystack webhook events should include:
  - `charge.success`
  - `subscription.create`
  - `subscription.disable`
  - `subscription.not_renew`
  - `invoice.payment_failed`
  - `invoice.update`

## Final Commands

```bash
npx supabase db push
npm run preflight
npm run preflight:production
npm run lint
npm run typecheck
npm run build
```

Run `npm run preflight:paystack` once Paystack keys and plan codes are ready.
