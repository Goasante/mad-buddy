# Security Provider Operations

Repository code cannot prove provider plan settings or dashboard switches. An
operator must record the date, account, and result of each check below without
copying secrets into this file or a ticket.

## HTTPS and HSTS

1. Open `http://mad-buddy.com` in a clean browser session.
2. Confirm it redirects to `https://mad-buddy.com`.
3. Run `curl -I http://mad-buddy.com` and confirm a `301`, `302`, `307`, or
   `308` response whose `Location` uses HTTPS.
4. Run `curl -I https://mad-buddy.com` and confirm the
   `Strict-Transport-Security` response header remains present.
5. Verify the custom-domain certificate is valid and auto-renewal is enabled in
   Vercel.

Do not add an application redirect solely to duplicate Vercel HTTPS enforcement.

## Supabase Auth

Verify in the production Supabase project:

- Email provider is enabled.
- Confirm email is enabled for ordinary email and password signup.
- Site URL is `https://mad-buddy.com`.
- Allowed redirect URLs include `https://mad-buddy.com/auth/callback`.
- Recovery-link expiry is recorded and is appropriately short.
- Access-token lifetime is recorded.
- Refresh-token rotation and reuse detection are enabled and their reuse
  interval is recorded.
- Password recovery emails use the production domain.
- Password reset is tested to confirm old sessions can no longer refresh after
  the reset completes.

Cloudflare Turnstile:

- Create separate production site and secret keys.
- Allow `mad-buddy.com`, any intentionally supported `www` hostname, Vercel
  preview hostnames used for testing, and `localhost` for the bundled Capacitor
  WebView.
- Configure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in
  Vercel. The secret must never use a `NEXT_PUBLIC_` or `VITE_` prefix.
- Configure `VITE_TURNSTILE_SITE_KEY` only when building the native bundle.
- Test expired, rejected, offline, and successful challenges on signup and
  password recovery.

## Supabase Backups

The current Supabase plan and backup status are not stored in this repository.
First check the production project under Billing and Database Backups.

If the project includes managed backups or point-in-time recovery:

1. Record retention, recovery window, region, and current status.
2. Confirm the latest backup completed successfully.
3. Perform and document a restore drill into an isolated non-production project.
4. Restrict restore access to the Owner and designated operators.

If the project does not include managed backups:

1. Link the Supabase CLI to the production project from an access-controlled
   operator machine.
2. Export roles, schema, and data with the supported Supabase CLI database dump
   commands, or use `pg_dump` with the provider's direct database connection.
3. Encrypt the dump immediately. Database exports can contain private profile,
   billing, and location-processing records.
4. Move the encrypted export to access-controlled off-site storage.
5. Apply a documented retention policy and delete expired copies securely.
6. Run exports on a schedule and alert on failed jobs.
7. Test restoration regularly in an isolated non-production database.

Never store a database dump, database password, connection string, or encryption
key in Git, application logs, or the web deployment.

## Provider Usage and Spend

Vercel:

- Configure usage notifications and spend limits for functions, bandwidth,
  image optimization, build minutes, and any metered add-ons.
- Route alerts to at least two trusted operators.

Supabase:

- Configure organization and project budget or usage notifications.
- Monitor database size, compute, egress, Realtime, Auth monthly active users,
  storage, and image transformations.
- Review service-role usage and database connections during every monthly
  security review.

Paystack:

- Enable settlement, failed charge, dispute, refund, and webhook monitoring.
- Reconcile Paystack settlements and fees with Mad Buddy financial snapshots.
- Alert on repeated webhook verification failures or delivery delays.

Media and storage:

- Monitor Supabase Storage volume and egress.
- Monitor any configured external media provider's storage, transformation, and
  delivery usage.
- Keep the existing media-cost thresholds and Owner alerts active.

Review all provider checks monthly and after any plan, domain, authentication,
payment, or storage change.
