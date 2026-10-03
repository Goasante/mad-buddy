# Contributing to Mad Buddy

Mad Buddy is an actively developed privacy-sensitive social product. Keep changes focused, reviewable and easy to trace.

## Before changing code

Read:

1. `docs/operations/START-HERE.md`
2. `docs/operations/PRODUCT-INVARIANTS.md`
3. `docs/database-map.md`
4. the latest relevant section of `docs/product/CONTINUATION.md`

Never infer production state from an old branch or handoff document.

## Branch names

- `feat/` — new product capability
- `fix/` — defect correction
- `chore/` — maintenance and repository housekeeping
- `docs/` — documentation-only work
- `hotfix/` — urgent production correction
- `release/` — release preparation

Prefer short descriptive names, for example `fix/conference-realtime-refresh`.

## Pull requests

Keep each PR about one coherent outcome. Explain what changed, why it changed, user or operational impact, privacy/security implications, how it was tested, and any intentionally deferred follow-up.

## Required checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For release-sensitive changes, follow the deployment and database runbooks rather than treating a successful build as production proof.

## Sensitive areas

Changes involving migrations, RLS, auth, admin authority, location/proximity, Safe Arrival, payments, privileged cron/jobs, CI/security tooling or mobile signing require explicit senior/founder review.

See `.github/CODEOWNERS` and `docs/operations/GITHUB-ACCESS-AND-REVIEW.md`.

## Secrets

Never commit production credentials, service-role keys, signing keys, recovery codes, session tokens, database dumps or private provider configuration.

If you suspect a secret has been exposed, follow `SECURITY.md` and rotate/revoke the credential before trying to clean Git history.
