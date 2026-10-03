<div align="center">

# Mad Buddy

### When your friends are close, they glow.

**A privacy-first proximity social app built to help people spend less time scrolling and more time connecting in real life.**

[Live product](https://mad-buddy.com) · [Developer setup](docs/operations/START-HERE.md) · [Product invariants](docs/operations/PRODUCT-INVARIANTS.md)

<img src="public/brand/mad-buddy-hero-mockup-v2.png" alt="Mad Buddy product preview" width="760" />

</div>

## What Mad Buddy does

Mad Buddy helps approved friends — **Muddies** — notice when they are nearby without exposing exact coordinates, street locations, raw distances, GPS accuracy or location history.

The product combines lightweight proximity awareness with private social coordination: people can see nearby friends, signal what they are **UpFor**, make Plans, create Events and Groups, use Safe Arrival, share temporary Stories, and join local anonymous Conference conversations.

The product principle is simple: **use technology to create more real-world connection, not more endless scrolling.**

## Core experiences

- **Glow** — privacy-safe proximity signals for approved friends.
- **UpFor** — show what you feel like doing and find Muddies who want in.
- **Plans & Events** — coordinate real-world meetups.
- **Messages & Groups** — private conversation and coordination.
- **Safe Arrival** — lightweight arrival check-ins with trusted Muddies.
- **Stories** — private photo sharing with a 12-hour lifetime.
- **Conference** — anonymous, radius-limited local conversations.
- **Linkr** — mutual social discovery without revealing one-sided interest.
- **Badges, achievements and Buddy Score** — lightweight trust and participation signals.

## Privacy by design

Location is a product input, not a social feed.

Mad Buddy does **not** expose exact coordinates, numerical distance, GPS accuracy, geohashes, street-level location or location history to other users. Nearby experiences use coarse privacy-safe projections, and users can pause visibility with controls such as Ghost Mode.

The complete non-negotiable privacy and product rules live in [`docs/operations/PRODUCT-INVARIANTS.md`](docs/operations/PRODUCT-INVARIANTS.md).

## Technology

| Area | Stack |
| --- | --- |
| Web | Next.js, React, TypeScript |
| Backend | Supabase Auth, PostgreSQL, RLS, RPCs, Realtime, Storage |
| Native | Capacitor with a bundled mobile SPA |
| Hosting | Vercel |
| Push | Web Push / VAPID and Firebase Cloud Messaging |
| Payments | Paystack for Mad Buddy Access |
| Quality | Vitest, ESLint, TypeScript, GitHub Actions |

The server and database remain authoritative for authentication, authorization, relationships, privacy boundaries, billing, Plans, Safe Arrival and notification membership. Client bundles never receive service-role credentials.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For local Supabase, staging and environment setup, use [`docs/operations/NEW-DEVELOPER-CHECKLIST.md`](docs/operations/NEW-DEVELOPER-CHECKLIST.md) and [`docs/operations/DATABASE-RUNBOOK.md`](docs/operations/DATABASE-RUNBOOK.md).

## Quality gates

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run preflight
```

CI independently validates web quality, production buildability, the mobile bundle, secret scanning and native/server boundary rules.

## Repository guide

- [`docs/operations/START-HERE.md`](docs/operations/START-HERE.md) — developer and operator entry point
- [`docs/product/CONTINUATION.md`](docs/product/CONTINUATION.md) — current product/release continuation authority
- [`docs/database-map.md`](docs/database-map.md) — domain and database map
- [`docs/operations/PRODUCT-INVARIANTS.md`](docs/operations/PRODUCT-INVARIANTS.md) — privacy and product rules
- [`docs/operations/DEPLOYMENT-RUNBOOK.md`](docs/operations/DEPLOYMENT-RUNBOOK.md) — release process
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution and branch conventions
- [`SECURITY.md`](SECURITY.md) — security reporting guidance

Historical handoffs and audits are retained under [`docs/archive/`](docs/archive/) rather than mixed into the active repository root.

## Project status

Mad Buddy is under active development. The public repository is the engineering source of truth; production credentials, provider secrets, signing material and recovery codes are intentionally kept outside GitHub.
