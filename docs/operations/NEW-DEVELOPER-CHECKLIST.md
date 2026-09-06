# New Developer Checklist

Use this before giving a new engineer access to Mad Buddy.

## 1. Read before touching code

- [ ] `docs/operations/START-HERE.md`
- [ ] `docs/operations/PRODUCT-INVARIANTS.md`
- [ ] `docs/operations/ENVIRONMENT-INVENTORY.md`
- [ ] `docs/database-map.md`
- [ ] latest section of `docs/product/CONTINUATION.md`
- [ ] `docs/product/MONETIZATION-ACCESS-MODEL.md`
- [ ] `docs/staging-reset-procedure.md`

## 2. Access level

Start with the least privilege needed.

- GitHub repository access does **not** imply Production provider access.
- Vercel/Supabase/Cloudflare/Paystack/Google/Apple access should be granted separately and only when required.
- Do not share one founder account between developers.
- Prefer named provider users/roles so access can be revoked individually.

## 3. Local setup

The normal web application is a Next.js/React/TypeScript project. Local backend development uses Supabase and Docker.

Recommended baseline:

```bash
npm ci
npx supabase start
npm run dev
```

Before first substantial change, run the repository quality baseline applicable to the task:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

For release-grade work, use the repository's release test command/runbook rather than inventing a smaller substitute.

## 4. Environment files

- Copy from `.env.example`; never ask another developer to send their `.env.local` file.
- `.env*` is gitignored.
- Only public/publishable values may use `NEXT_PUBLIC_*` or `VITE_*`.
- Never put a service-role key, provider private key, DB password, Firebase service-account credential, VAPID private key, cron secret, or signing secret in browser/native env.
- Obtain secrets through the approved private vault only if the role requires them.

## 5. Supabase target safety

Before any remote migration, reset, seed, or destructive database operation:

1. Inspect the linked project ref immediately before the command.
2. Compare it against the intended environment.
3. Hard-stop if the Production ref appears during a staging/local destructive workflow.

Known refs at this checkpoint:

- Production: `cabkhxxnrybzhkbtoiiz`
- Staging: `ivaydmciwmjdjsrovbqb`

Do not trust the folder/worktree name as proof of target.

## 6. Database rules

- Migrations are canonical history.
- Do not hand-patch Production and leave the fix absent from migrations.
- RLS/server authorization is the security boundary.
- Service-role actions must perform explicit authorization before privileged reads/writes.
- Never use real Production users as test fixtures.

## 7. Product rules that frequently cause regressions

- No exact location/distance/map/history exposure.
- Linkr one-sided decisions remain private.
- Event attendance/check-in/Event-Linkr consent are distinct.
- Multiple owned UpFors are valid.
- Existing social continuity remains free when Access expires; expansion is the monetized boundary.
- Safe Arrival is never paywalled.
- Moments is paused for the current phase.
- Do not rebuild canonical Plan/RSVP/chat or UpFor lifecycle logic inside UI components.

Read `PRODUCT-INVARIANTS.md` for the complete set.

## 8. Git workflow

Until team policy changes:

- branch from the exact agreed `main` SHA,
- make focused commits,
- open a PR,
- wait for required CI/tests,
- record exact head SHA in handoff/review,
- do not deploy Production without explicit release authority.

`main` was not protected when this handoff was created. That is an operational gap, not permission to push directly.

## 9. Deployment and runtime proof

A green build is necessary but not sufficient.

For Production-capable changes, verify:

- exact commit lineage,
- migration state/pending drift,
- CI result on exact head,
- Vercel deployment/alias,
- served application/runtime behavior,
- rollback route.

Do not declare success only because a Vercel deployment id exists.

## 10. Native development

The native app uses Capacitor with app id `com.madbuddy.app` and bundles the `mobile/dist` SPA.

- Native `VITE_*` variables are public.
- Android release keystore/passwords are external to Git.
- Firebase client config files are build inputs and gitignored.
- iOS/Android signing/store credentials remain owner/operator secrets.
- Native-specific behavior includes safe areas, status bar, keyboard, back/gestures, lifecycle, permissions, OAuth/deep links, push, media access, and store signing.

## 11. Before requesting Production access

A developer should be able to explain:

- what they need access to,
- why local/staging is insufficient,
- what exact operation they intend to perform,
- rollback/recovery if it fails,
- what logs/evidence will prove success,
- whether the action touches real users or billing.

If those answers are unclear, do not grant Production access yet.

## 12. Leaving the project

On departure:

- remove provider access,
- remove GitHub/Vercel/Supabase/Cloudflare/Paystack/Google/Apple access as applicable,
- remove vault access,
- rotate any shared secret they could retain,
- review audit logs,
- transfer open work/branches and operational ownership.
