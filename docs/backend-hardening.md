# Backend Hardening Notes

## Applied

- Added additive indexes for high-traffic lookup columns in `20260710100000_backend_hardening.sql`.
- Added database-backed rate limiting through `public.consume_rate_limit`.
- Added server-side rate limits for:
  - signup
  - login
  - user search
  - friend requests
  - location updates
  - nearby friends checks
  - report submissions
  - Paystack checkout/session creation
- Added privacy-safe structured logging for important auth, social, location, nearby, and Paystack checkout actions.
- Kept backend state stateless: rate limits, auth, premium status, and location state are stored in Supabase/Auth/database tables.

## Verified

- `user_locations` has RLS owner-only access.
- Nearby friends endpoint uses service role internally but returns only safe proximity fields.
- `assertPrivacySafeResponse` rejects exact location/distance fields from nearby responses.
- Premium feature mutations call server-side plan checks before writing.
- Sensitive tables have RLS enabled in migrations.
- Account deletion anonymizes reports and deletes user-owned app data before removing the Supabase Auth user.

## Non-Destructive Schema Findings

These were reviewed but not changed automatically because they could affect existing data or product behavior:

- `friend_requests` allows repeated historical requests between the same pair. A partial unique index for active pending requests could be added later after checking for duplicates.
- `reports.reason` is free text. A stricter enum could improve analytics, but it would require migrating existing report reasons.
- `notifications.type` is free text while TypeScript uses a union. A database enum could be added later, but existing rows should be audited first.
- `privacy_zones` stores exact user-owned coordinates. This is necessary for private zone matching, but those values must remain owner-only/server-only.
- `deletion_audit_logs.user_id` intentionally has no foreign key because the auth user is deleted.

## Operational Notes

- Apply the migration before relying on new rate limits in a shared environment.
- Do not log request bodies for location, privacy-zone, Paystack, auth, or token-bearing routes.
- Set `ADMIN_EMAILS` before production use of `/safety`.
