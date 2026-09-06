# Security and Secret Rotation Runbook

This runbook covers secrets and provider credentials. It never records actual secret values.

## What counts as a secret

Treat these as secrets or sensitive operator credentials:

- Supabase service-role key and database password
- Paystack secret/webhook credentials
- Cloudflare Turnstile secret
- VAPID private key
- contact-matching HMAC keys
- cron scheduler credentials
- Firebase service-account JSON/private key
- Android signing keystore/passwords
- Apple signing/APNs private keys/certificates
- provider recovery codes
- database dumps containing user data
- any temporary QA/session/auth token

Public client identifiers (Supabase publishable/anon key, site keys, GA IDs, VAPID public key) are not secrets, but should still be documented and controlled as configuration.

## Storage rule

Production secrets live in provider-managed secret stores and/or the Mad Buddy private vault.

Never store them in:

- Git tracked files or Git history
- Markdown documentation
- issue/PR comments
- chat handoffs
- screenshots
- public CI logs
- client-side `NEXT_PUBLIC_*` / `VITE_*` variables
- native application bundles

## Repository scanner

Mad Buddy already includes:

```bash
node scripts/security/scan-secrets.mjs
node scripts/security/scan-secrets.mjs --history
```

The scanner reports type/location and deliberately does not print matched values.

Current CI runs the tracked-tree scan. Full-history scanning is an explicit operator task until a dedicated history workflow is added.

## If a secret is exposed

Order matters:

1. **Revoke/rotate first.** Assume copying is possible once a secret appears in an exposed location.
2. Update the provider/server environment to the replacement.
3. Redeploy/restart dependent services if necessary.
4. Prove the old credential no longer works where the provider supports revocation testing.
5. Prove the new credential works.
6. Search repository/history/logs/tickets/screenshots for additional copies.
7. Remove exposed material from active surfaces/history as appropriate.
8. Review provider audit logs for suspicious use.
9. Record incident date, credential type, provider, operator, and outcome — never the value.

Deleting the current file before rotation is not sufficient.

## Dependency/rotation matrix

| Credential | Primary consumers | Rotation notes |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | server actions/routes/jobs/admin operations | Replace in all server environments; never native/browser |
| `SUPABASE_DB_PASSWORD` | CLI/direct DB operator access | Rotate in Supabase; update operator vault/local setup |
| `PAYSTACK_SECRET_KEY` | checkout/payment verification | Update Vercel/server; verify live/test environment carefully |
| `PAYSTACK_WEBHOOK_SECRET` | webhook verification | Rotate independently if supported; verify delivery after change |
| `TURNSTILE_SECRET_KEY` | signup/recovery verification | Pair with correct production Turnstile site |
| `VAPID_PRIVATE_KEY` | web push | Public/private pair must remain consistent with subscriptions; rotation may require resubscription strategy |
| `CONTACT_MATCH_HMAC_SECRET*` | contact discovery HMAC | Versioned by design; do not delete old versions until stored identifiers no longer depend on them |
| `CRON_SECRET` | GitHub Actions backstop | Independent from DB scheduler; update GitHub secret + server env |
| `CRON_DB_SECRET` | Supabase pg_cron primary | Independent from GitHub secret; update server env + Supabase Vault configuration |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | native push server transport | Rotate service-account key in Google/Firebase; update server env; revoke old key |
| Android keystore/upload key | Android release | Follow Play recovery process; loss can block releases depending on Play App Signing setup |
| Apple signing/APNs key | iOS release/push | Rotate/revoke in Apple Developer and update CI/operator vault |

## Scheduler-secret special case

Mad Buddy intentionally uses two credentials for `/api/cron/tick`:

- `CRON_DB_SECRET` — primary Supabase pg_cron scheduler.
- `CRON_SECRET` — GitHub Actions recovery backstop.

Do not replace these with one shared value merely for convenience. Independent credentials allow one scheduler to be rotated/revoked without taking down the other.

Supabase pg_cron stores its endpoint/secret in Supabase Vault through the private configuration function defined by migration. Never hard-code that secret into a migration.

## Contact-match secret special case

Contact matching uses keyed HMAC rather than plain hashes. Keys are versioned so a rotation can coexist with older stored identifiers.

Do not:

- replace HMAC with plain SHA-256,
- use a short/default secret,
- bump key version without planning recomputation/compatibility,
- delete old key material while database rows still reference its version.

## Mobile/signing special case

Release signing credentials are business-continuity assets, not ordinary developer config.

- Keep at least one protected backup outside the active development laptop.
- Record owner/backup owner in the provider registry.
- Never email/share keystores and passwords together.
- Prefer provider-managed signing/recovery such as Play App Signing where appropriate.
- Restrict Apple/Google signing access to developers who actually release builds.

## Rotation evidence template

```text
Credential: <NAME>
Provider/environment: <PRODUCTION/STAGING>
Reason: scheduled / role change / suspected exposure / provider request
Old credential revoked: YES/NO/NOT SUPPORTED
New credential activated: YES/NO
Dependants updated: <systems>
Verification: <safe result, no secret>
Operator: <name>
Date: <UTC date/time>
Follow-up: <if any>
```

## Periodic checks

At least quarterly and after staff/provider changes:

- run tree and history secret scans,
- review provider administrators,
- remove stale developer access,
- verify backups/recovery,
- review secret age and provider rotation capability,
- confirm Production/staging separation,
- verify signing assets and recovery material remain accessible to authorized owners.
