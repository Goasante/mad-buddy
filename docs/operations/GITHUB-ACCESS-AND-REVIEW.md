# GitHub Access and Review Policy

Mad Buddy's repository is currently public and `main` was observed unprotected during this operations audit. Before external developers receive write access, enable branch/ruleset protection so repository convention becomes enforceable rather than advisory.

## Current repository authority

- Repository: `Goasante/mad-buddy`
- Default branch: `main`
- Visibility: public
- Current founder review owner: `@Goasante`
- Sensitive paths are declared in `.github/CODEOWNERS`.

## Minimum protection before onboarding developers

Configure a GitHub branch protection rule or repository ruleset for `main` that requires:

1. Pull requests before merge.
2. Required CI checks to pass before merge.
3. At least one approving review.
4. Code-owner review for CODEOWNERS-managed paths.
5. Dismiss stale approvals when sensitive commits are added after review, if available on the account plan.
6. Block force-pushes to `main`.
7. Block branch deletion for `main`.
8. Keep direct Production deployment authority separate from ordinary repository write access.

Do not grant every developer admin permission merely so they can ship code.

## Suggested human roles

### Founder / repository owner

May:

- administer repository settings,
- approve sensitive CODEOWNERS changes,
- approve Production migration/payment/auth/security changes,
- manage provider access,
- perform or delegate release decisions.

### Senior / lead developer

Normally needs:

- repository write access,
- PR/review access,
- staging access,
- no standing Production service-role/database password unless their role genuinely requires it.

### Product/frontend developer

Normally needs:

- repository write access through branches/PRs,
- synthetic staging/test access,
- no Paystack live secret,
- no Supabase Production service-role key,
- no domain/Cloudflare admin,
- no store signing keys unless they own release operations.

### Contractor / temporary developer

Prefer:

- least-privilege repository access,
- no provider billing/admin roles,
- no shared Production credentials,
- explicit access-expiry/removal date.

## Sensitive review areas

Changes touching any of these should receive explicit senior/founder review even if CI is green:

- `supabase/migrations/`
- RLS, SECURITY DEFINER functions and grants
- auth/session/OAuth flows
- `SUPABASE_SERVICE_ROLE_KEY` consumers
- Paystack / Mad Buddy Access
- Safe Arrival
- location/proximity privacy projections
- admin permissions
- cron/jobs with privileged effects
- `.github/workflows/`
- mobile signing/release configuration
- secret-scanning/ignore rules

Green CI does not prove a business-authorization or privacy decision is correct.

## Merge discipline

Preferred sequence:

```text
feature/fix branch
→ targeted tests
→ full required CI
→ review
→ merge main
→ deployment/runtime proof as required
→ continuation/release record
```

Do not use Production as the first integration test.

## Developer departure

When access is removed:

1. Remove repository/org access.
2. Remove provider/project roles (Vercel, Supabase, Cloudflare, Paystack, Google/Firebase, stores).
3. Remove private-vault shares.
4. Rotate any shared credential the person had access to where individual credentials were not possible.
5. Review audit logs and recent merges.
6. Confirm their forks/worktrees contain no Production secret material before device disposal/return where the business controls the device.

## Repository visibility

Public repository visibility is compatible with secure operation only if secrets and privileged credentials remain outside Git. Public source should be treated as fully inspectable by attackers. Security must come from server/database authorization, RLS, protected provider credentials and correct secret management — never from hiding implementation details.
