# Supabase Setup

Stage 10 added the local Supabase foundation. Later migrations connect live auth, Paystack billing, and privacy-safe location endpoints.

## Apply Migrations

Use the Supabase CLI after creating/linking a project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

For local development:

```bash
supabase start
supabase db reset
```

## Privacy Guarantees In The Schema

- `user_locations` is owner-only by RLS.
- No policy allows one user to read another user's raw location.
- `privacy_zones` is owner-only by RLS.
- `proximity_events` stores derived proximity only.
- Deletion audit logs do not store raw location.
- `cleanup_expired_private_location()` removes stale raw location rows.

## Scheduled Cleanup

Configure a scheduled job later to call:

```sql
select public.cleanup_expired_private_location();
select public.cleanup_expired_proximity_events();
```

Supabase can run this with `pg_cron` if enabled, or from a secure scheduled backend job.
