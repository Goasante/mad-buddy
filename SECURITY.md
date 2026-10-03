# Security Policy

Mad Buddy handles identity, private social relationships and privacy-sensitive proximity data. Security reports should be handled privately and with enough detail to reproduce the issue safely.

## Reporting a vulnerability

**Do not open a public GitHub issue for a suspected security vulnerability.**

Use GitHub private vulnerability reporting if it is available for this repository. Otherwise contact the repository owner, [@Goasante](https://github.com/Goasante), through an established private channel before disclosing technical details publicly.

Please include the affected area, reproduction steps, expected and observed behavior, impact, and whether production data or credentials may be involved.

Do not include real user data, access tokens, passwords, service-role keys or other secrets in the report.

## High-priority areas

- authentication or session handling
- authorization / RLS bypass
- exact-location or relationship privacy leakage
- Safe Arrival privacy
- admin privilege escalation
- payment or entitlement manipulation
- exposed server/service-role credentials
- push-notification data leakage
- arbitrary file access or upload abuse

## Credential exposure

If a real credential is exposed, treat it as compromised: rotate or revoke it first, verify the replacement, investigate provider/audit logs, and only then remove the exposed material from active surfaces and history where appropriate.

Deleting a credential from the latest commit does not make an exposed credential safe.
