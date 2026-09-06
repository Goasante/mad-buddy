# Mad Buddy

Mad Buddy is a privacy-first social proximity app. Approved friends can appear as coarse Glow signals when they are nearby, without exposing exact coordinates, raw distance, GPS accuracy, location history, maps, or street-level location.

## Start Here

For current operational/developer authority, begin with:

- `docs/operations/START-HERE.md`
- `docs/product/CONTINUATION.md`
- `docs/database-map.md`
- `docs/operations/PRODUCT-INVARIANTS.md`

Historical stage checklists and old handoff files are not release authority.

## Current Architecture

- Next.js App Router + React + TypeScript
- Supabase for Auth, Postgres, Storage, Realtime, RLS, RPCs and local/staging tooling
- Vercel for the production web/API deployment
- Paystack for Mad Buddy Access billing
- Firebase Admin / FCM for native push when configured
- Web Push via VAPID
- Capacitor Android/iOS shells plus the mobile bundle

The server/database remain the authority for authentication, authorisation, relationships, Linkr mutuality, UpFor ownership, Plans, Safe Arrival, billing and notification membership. Client/native bundles must never contain service-role or other privileged credentials.

## Product / Privacy Invariants

Do not change these casually:

- No exact location, numerical distance, GPS accuracy, geohash, street location or location history may be exposed to clients.
- Safe Arrival must never imply live tracking when the data is stale/unknown.
- One-sided Linkr decisions remain private; only mutual connections become relationship context.
- Existing relationships and commitments survive Mad Buddy Access expiry.
- Mad Buddy Access unlocks social expansion through Linkr and the relevant expansion side of UpFor; it does not paywall the user's existing social world.
- Moments is paused and must not silently return as a required loop.

See `docs/operations/PRODUCT-INVARIANTS.md` for the complete current rules.

## Mad Buddy Access / Paystack

The current consumer billing product is **Mad Buddy Access**, not the retired Buddy Plus / Buddy Pro ladder.

Current source authority lives in:

- `lib/access/product.ts`
- `lib/access/resolver.ts`
- `app/api/access/checkout/route.ts`
- `app/api/paystack/webhook/route.ts`
- `docs/product/MONETIZATION-ACCESS-MODEL.md`

The client sends only the stable product identifier. Price and provider plan authority are server-owned. The legacy Plus/Pro configuration remains only for retained compatibility paths and is not current onboarding authority.

Before live billing, configure the Paystack provider transport values listed in `.env.example` and `docs/deployment-checklist.md`, and configure the webhook endpoint at `/api/paystack/webhook`.

## Getting Started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For local Supabase/Docker, safe environment setup and staging rules, follow `docs/operations/NEW-DEVELOPER-CHECKLIST.md` and `docs/operations/DATABASE-RUNBOOK.md` rather than guessing from old worktree state.

## Useful Commands

```bash
npm run dev
npm run preflight
npm run preflight:production
npm run preflight:paystack
npm run test:release
npm run lint
npm run typecheck
npm run build
```

## Environment Variables

Copy `.env.example` to `.env.local` for local work. Never commit `.env.local`, production credentials, service-role keys, provider private keys, signing keys or recovery codes.

The safe inventory and secret classification live in `docs/operations/ENVIRONMENT-INVENTORY.md`. Actual secret values belong in the private Mad Buddy vault, not in GitHub documentation.

## Production Safety

Before any release or destructive database operation:

1. Verify the exact Git SHA/branch.
2. Verify the Supabase project target explicitly.
3. Run the required release gates.
4. Never reset/seed/load Production.
5. Follow `docs/operations/DEPLOYMENT-RUNBOOK.md` and `docs/operations/DATABASE-RUNBOOK.md`.

The repository's current production/staging references and migration status are recorded in the operational handoff and continuation documents.
