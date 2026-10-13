# Godfred bookshop

Independent Next.js 16 book catalogue, reader pages and owner publishing desk, hosted on Netlify. The Mad Buddy app remains on its existing infrastructure. This project has no Supabase dependency.

## Storage and access

Netlify Blobs `godfred-bookshop-v2` stores catalogue configuration with optimistic ETag checks, immutable PDF uploads, image uploads, transaction records, download deliveries and admin audit records. New paid PDFs are only reachable through verified download endpoints. The already-free first edition is bundled in the server deployment and is also present in this public source repository; changing its listing cannot retroactively make copies private. Upload a new edition to charge for protected access.

The owner sets `BOOK_ADMIN_PASSWORD` (16+ characters) manually as a production secret. `BOOK_DOWNLOAD_SECRET` signs eight-hour, HTTP-only admin sessions and 24-hour purchase links. Password changes invalidate existing admin sessions. All owner mutations check the configured site Origin. Conditional writes prevent concurrent edits from overwriting one another. Login attempts and public API calls use atomic rate-limit records.

## Payments

Paystack remains the processor. Both production environment `BOOK_SALES_ENABLED=true` and owner setting `paymentsEnabled=true` are required. A successful callback alone never grants access: amount, currency, mode, order metadata, reference and customer email must match provider verification. Browser proofs are HTTP-only cookies; receipt links expire after 24 hours. Resend sends transactional receipts and recovery links. Repeated webhook deliveries are deduplicated by order reference and provider email idempotency keys. App events retain signature-checked forwarding.

USD contributions are converted server-side using the displayed, owner-managed GHS rate; rate changes require confirmation rather than silently changing the charge. The rate is a displayed store conversion, not a claim to match a customer's bank rate. Paid books have fixed GHS prices.

## Measurements

Delivery events count PDFs returned by the server, not proof of saves or reading. Distinct-browser measurement uses a first-party cookie only when a reader selects the optional setting. Scheduled retention deletes expired security counters and download records older than a year. Reports are explicitly partial if their record cap is reached. Paystack is authoritative for refunds, settlements and accounting. Campaign enquiries open the reader's email app and do not create a marketing subscription.

## Operations

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Production uses Node 22. Keep previews disabled. The owner can publish/archive books, replace assets with versioned uploads, edit author/services copy and policies, manage access modes, choose prices and contribution rates, and recheck payment references. Maximum upload size is 4 MB.

Before opening paid checkout: verify the production Paystack key, successful payment verification, webhook routing, receipt delivery and access recovery in an isolated test mode or with an owner-authorized real payment. No automatic paid transaction is performed during development.
