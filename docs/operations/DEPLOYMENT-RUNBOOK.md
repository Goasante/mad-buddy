# Deployment and Release Runbook

This runbook describes how to reason about a Mad Buddy release. It does not grant authority to deploy Production.

## Current platform

- Web host: Vercel
- Production domain: `https://mad-buddy.com`
- Vercel project: `mad-buddy`
- Vercel function region in source: `lhr1`
- Repository: `Goasante/mad-buddy`
- Default branch: `main`
- Current source quality commands: `npm run test:release`, `npm run typecheck`, `npm run lint`, `npm run build`

## Release principle

A release is not complete because:

- a PR merged,
- Vercel produced a deployment,
- a deployment id mentions the expected SHA,
- or a database migration command returned success.

A release is complete only when code lineage, database state, CI/build state, and served runtime all agree.

## Normal release sequence

1. **Pin authority**
   - Record base SHA.
   - Record candidate/PR head SHA.
   - Confirm worktree/branch is clean enough for the operation.

2. **Review change scope**
   - Identify code changes, migrations, env/provider changes, and user-data impact.
   - Identify rollback strategy before deployment.

3. **Quality gates**

```bash
npm run test:release
npm run typecheck
npm run lint
npm run build
```

Use additional domain/runtime proof required by the change.

4. **CI exact-head proof**
   - Require CI/status on the exact candidate head.
   - Do not rely on a previous green commit after the branch moved.

5. **Database preflight**
   - Count local migrations.
   - Compare Production remote migration head/pending state.
   - Verify target project ref immediately before any remote command.
   - Never use a staging/local destructive command against Production.

6. **Merge/release authority**
   - Merge only after review authority approves the exact head.
   - Record the resulting `main` SHA.

7. **Apply database changes if required**
   - Apply only reviewed migration files from canonical history.
   - Verify applied count/head and zero unexpected drift.
   - Do not hand-patch Production as a substitute for a migration.

8. **Deploy**
   - Allow/trigger the Vercel deployment corresponding to the intended `main` SHA.
   - Confirm custom-domain alias points to intended deployment.

9. **Runtime verification**
   - Verify `/api/version`/build identity where applicable.
   - Smoke critical routes affected by the change.
   - For authenticated changes, use safe approved QA identity/fixture policy; never mutate arbitrary real users.
   - Verify any provider callback/webhook affected by the release.

10. **Closeout**
    - Record exact `main` SHA.
    - Record Production migration count/head.
    - Record deployment identifier/served-domain result.
    - Record tests/runtime proof and unresolved risks.
    - Update `docs/product/CONTINUATION.md`.

## Production deployment hold conditions

Stop rather than deploy if any of these is unresolved:

- branch/base lineage is unclear,
- exact-head CI has not completed,
- migration target cannot be proven,
- a secret/provider configuration is unknown,
- rollback is unavailable for a risky change,
- safety/privacy behavior is unproven,
- build passes but required runtime flow is broken,
- the change unexpectedly touches real-user data.

## Rollback

The rollback method depends on change type.

### Web/code-only

Prefer deploying/reverting to the last known-good reviewed commit. Confirm runtime serves the rollback SHA.

### Database change

Do not automatically reverse a migration by guessing SQL. Determine whether the migration is safely reversible, forward-fixable, or data-transforming. Production data preservation outranks symmetry.

### Provider/config change

Restore the last known-good provider setting/secret only if it is still valid and uncompromised. A leaked/revoked credential must not be restored.

## Vercel notes

- `vercel.json` currently pins region `lhr1`.
- Canonical public domain is `mad-buddy.com`.
- `mad-buddy.vercel.app` may redirect to the custom domain; privileged requests must not rely on Authorization headers surviving a cross-host redirect.
- Vercel automatically supplies build/deployment environment metadata such as commit/domain values used by the app.

## Scheduled jobs are not Vercel Cron authority

Primary job cadence is Supabase `pg_cron` → `/api/cron/tick` every five minutes. GitHub Actions is the recovery backstop. Do not move safety-sensitive cadence to a throttled best-effort scheduler without explicit architecture review.

## Payment release checks

For payment changes:

- current consumer product authority is Mad Buddy Access,
- server owns amount/plan,
- Paystack webhook signature verification must remain fail-closed,
- forged or wrong-amount events must not grant Access,
- checkout/webhook provider configuration must be verified in the intended environment,
- never test a live-charge path casually with a real user's billing state.

## Native release relationship

The native apps consume the same backend/server authority but have their own signing/store release process. A successful web deployment does not mean an Android/iOS binary is ready for store release.
