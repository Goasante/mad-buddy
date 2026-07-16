# Mad Buddy

Mad Buddy is a privacy-first social proximity web app. Approved friends appear as glow signals when they are nearby, without exposing exact locations, maps, distance, GPS accuracy, or location history.

## Project Status

Stage 0 and Stage 1 are complete:

- Fresh project inspection
- Next.js App Router setup
- TypeScript setup
- Tailwind CSS setup
- Shadcn/UI configuration
- Core dependencies listed
- Environment example
- Initial route structure
- Stage 2 design system foundation
- Reusable UI primitives
- Glow and proximity display utilities
- Stage 3 public landing page
- Stage 4 auth UI pages with validation states
- Stage 5 onboarding UI flow
- Stage 6 app shell and dashboard UI
- Stage 7 friends UI with request, block, and report states
- Stage 8 profile, settings, notifications, data export, and delete account UI
- Stage 9 pricing, premium, billing, and subscription result UI
- Stage 10 Supabase schema, RLS policies, storage bucket, and typed clients
- Stage 11 Supabase auth integration, session middleware, callback route, and protected routes
- Stage 12 profile and friends server actions for Supabase integration
- Stage 13 location update and privacy-safe nearby friends backend
- Stage 14 notification creation, list/read APIs, and nearby alert throttling
- Stage 15 Paystack checkout, webhook sync, billing status, and premium access helper
- Stage 16 premium feature controls with backend plan enforcement
- Stage 17 privacy settings persistence, data export, and account deletion backend
- Stage 18 safety dashboard for report review, moderation actions, and deletion audits
- Stage 19 Paystack checkout, webhook, and billing readiness

Paystack env keys and plan codes are required before live checkout works.

Set `ADMIN_EMAILS` to a comma-separated allowlist before using `/safety` in production.

## Paystack Setup Checklist

1. Create two recurring Paystack subscription plans: Buddy Plus and Buddy Pro.
2. Add these values to `.env.local`:
   - `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
   - `PAYSTACK_SECRET_KEY`
   - `PAYSTACK_WEBHOOK_SECRET`
   - `PAYSTACK_BUDDY_PLUS_PLAN_CODE`
   - `PAYSTACK_BUDDY_PRO_PLAN_CODE`
   - `NEXT_PUBLIC_APP_URL`
3. Configure the webhook endpoint as:
   - Local tunnel or deployed URL: `/api/paystack/webhook`
4. Configure the callback URL as:
   - Local development: `http://localhost:3000/subscription-success`
   - Production: `https://your-domain.com/subscription-success`
5. Subscribe the webhook to:
   - `charge.success`
   - `subscription.create`
   - `subscription.disable`
   - `subscription.not_renew`
   - `invoice.payment_failed`
   - `invoice.update`
6. Restart the dev server after editing `.env.local`.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Useful Commands

```bash
npm run dev
npm run preflight
npm run preflight:production
npm run preflight:paystack
npm run build
npm run lint
npm run typecheck
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill values as each integration is added.

## Privacy Rule

Frontend responses must never include exact coordinates, raw distance, GPS accuracy, geohashes, location history, or map pins. The UI should only receive safe proximity signals.
