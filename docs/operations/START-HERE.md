# Mad Buddy Operations — Start Here

This directory is the safe operational handoff for Mad Buddy. It is written so a new developer or operator can understand how to work on the product without hunting through historical chats or guessing which document is current.

## Security rule

**Never put production secrets, passwords, private keys, recovery codes, database dumps, or signing credentials in this repository.**

Repository documentation may name a credential and state where it is stored, for example:

`PAYSTACK_SECRET_KEY — Mad Buddy Vault → Paystack → Production API`

It must never contain the credential value.

Actual credentials belong in the private Mad Buddy production vault controlled by the owner.

## Current repository authority

- Repository: `Goasante/mad-buddy`
- Default branch: `main`
- Main SHA at creation of this handoff: `5d50c19dea4744e678de18e5990de5a00992d9b4`
- Repository visibility: **public**
- `main` branch protection at this checkpoint: **not enabled**
- Production database migration count at this checkpoint: **137**
- Production application domain: `https://mad-buddy.com`
- Native app identifier / bundle ID: `com.madbuddy.app`

If these values change, update this page and `docs/product/CONTINUATION.md`.

## Read these first

1. `ENVIRONMENT-INVENTORY.md` — every important configuration/secret class and where it belongs.
2. `PROVIDER-REGISTRY.md` — external accounts/services that must have clear ownership and recovery.
3. `PRODUCT-INVARIANTS.md` — product/security rules developers must not accidentally redesign away.
4. `NEW-DEVELOPER-CHECKLIST.md` — safe setup and first-day workflow.
5. `FOUNDER-CHECKLIST.md` — facts only the owner can fill in, such as account ownership, billing, 2FA, recovery, and vault location.

Existing supporting documents remain authoritative for their specialist areas:

- `docs/database-map.md`
- `docs/security-provider-operations.md`
- `docs/deployment-checklist.md`
- `docs/staging-reset-procedure.md`
- `docs/product/CONTINUATION.md`
- `docs/product/MONETIZATION-ACCESS-MODEL.md`

Where an older document conflicts with current source code, source code plus the latest continuation record wins until the documentation is reconciled.

## Architecture in one minute

### Web

The primary product is a Next.js / React / TypeScript application deployed on Vercel and backed by Supabase Auth, PostgreSQL, Storage, Realtime, RLS, RPCs, jobs, and server-side service-role operations.

### Native

The Capacitor application uses app id `com.madbuddy.app`. It bundles the `mobile/dist` Vite SPA into the native binary; it does **not** load the production website as a remote WebView. The bundled mobile client talks to Supabase and the web application's `/api/*` routes over HTTPS.

### Database and authority

Supabase is canonical server truth. User-facing clients must never receive service-role credentials. RLS and server-side authorization are security boundaries; hiding code in the client is not security.

### Scheduling

The primary recurring scheduler is Supabase `pg_cron`, which calls `/api/cron/tick` every five minutes. GitHub Actions is a recovery backstop, not the primary scheduler. The two schedulers intentionally use separate credentials.

### Payments

The current consumer product is **Mad Buddy Access**, not the old Buddy Plus / Buddy Pro feature ladder. Current source authority is `lib/access/product.ts` and `docs/product/MONETIZATION-ACCESS-MODEL.md`. Legacy Plus/Pro references elsewhere in the repository are documentation debt and must not be treated as product authority.

## Production safety rules

- Never run a destructive Supabase command until the target project ref is explicitly verified.
- Never seed, reset, load-test, or use real user identities in Production.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, provider private keys, database passwords, or signing secrets into browser/native environment variables.
- Never merge or deploy solely because a build succeeds; verify the exact commit and the served runtime.
- Never weaken privacy boundaries for convenience.
- Never reuse Production secrets in staging if provider separation is available.

## Current known operational debt

This handoff tranche has already identified these items for reconciliation:

- `.env.example` is incomplete for newer runtime variables such as native Firebase service-account configuration and the independent database cron credential.
- Some payment/readiness/deployment documentation still refers to the retired Buddy Plus / Buddy Pro configuration while the current product is Mad Buddy Access.
- `AI_HANDOFF.md` is historical and should not be treated as current onboarding authority.
- iOS ignore rules are thinner than Android signing-secret protections and should be hardened before release signing work.
- CI scans the tracked tree for common credential patterns, but the repository's full Git history still needs an explicit historical secret scan.
- `main` is currently unprotected; before external developers join, require a reviewed PR/CI workflow appropriate to the team's size.

## Secret incident rule

If a genuine production credential is ever found in Git history, logs, screenshots, chat exports, tickets, or another exposed location:

1. **Rotate/revoke the credential first.**
2. Confirm the replacement is active.
3. Remove the exposed material from active surfaces/history where appropriate.
4. Check logs/provider audit trails for misuse.
5. Record the incident and rotation date without recording the secret value.

Do not assume deleting a file from the latest commit makes a leaked credential safe.
