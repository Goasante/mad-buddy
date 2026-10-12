# M&A book sales

The public page is `/books/ma-prospecting-playbook`. The price authority is `lib/books/product.ts`: GHS 200.00 = 20,000 pesewas. It is a one-time purchase and never grants or changes a Mad Buddy app subscription.

## Checkout and the existing payment-page link

The website uses the existing merchant account's server-created Paystack checkout. Each checkout has a pending order, a unique reference, product metadata and an HTTP-only browser proof. Paystack receives the fixed server price; client-supplied amounts are rejected.

The owner-created page `https://paystack.shop/pay/vbezrleavm` is recorded in the product configuration. It is **not the purchase button**: an independently paid hosted page lacks the website's pre-created order and browser proof. Do not promote that standalone link as automatic book delivery. Promote the book landing page once activation is complete. This avoids treating a different GHS 200 payment as a book purchase. No existing payment-page settings were modified.

## Activation checklist

1. Apply `supabase/migrations/20261012140804_book_sales.sql` to the production project through the repository's normal migration process. The migration adds service-only orders and the private `book-files` bucket. Do not make this bucket public or give customers Storage access.
2. Upload the complete 38-page PDF to **book-files / ma-prospecting / v1.pdf**. The original full PDF must never be committed to this public GitHub repository or copied into `public/`. Only the five-page sample, cover and social image are public.
3. Configure a cryptographically random server-only `BOOK_DOWNLOAD_SECRET`, at least 32 characters, in the deployment environment. Reuse the already configured `PAYSTACK_SECRET_KEY`, Supabase service role and Resend credentials. Do not paste keys into source files or client variables.
4. Confirm `RESEND_API_KEY` and `MAD_BUDDY_EMAIL_FROM` are configured with an authorised sender. Receipts and recovery messages use the existing email helper. Enable international cards in Paystack as appropriate for the ebook business.
5. Retain the existing Paystack webhook `/api/paystack/webhook`. It now dispatches the exact book product separately before app payment handlers. Confirm that this webhook URL is actually configured in Paystack live settings.
6. Set `BOOK_SALES_ENABLED=true` only after the master, migration, mail and signing secret are configured. Before activation the book page and sample work, but purchases fail closed with “Purchases open soon”.
7. Verify with test-mode credentials on a non-production environment: correct purchase, pending/failed payment, wrong amount/currency/product/email/domain, callback in another browser, replayed webhook, expired or modified download link, recovery and provider email failure.
8. After deployment, the owner should complete one live purchase and confirm the personalised 38-page PDF, receipt email, recovery and Mobile Money completion. Do not mark real customer payments successful manually.

## Protection and delivery

Book orders are inaccessible to anonymous and authenticated API roles. Restrictive Storage policies exclude the private bucket even where old permissive policies exist. The server checks the bucket is private before checkout and delivery, checks a master exists, verifies the transaction with Paystack and checks the stored order/product/customer/domain. It stamps a fresh PDF with email and reference without altering the master. Download tokens are signed, scoped to the book and expire in 24 hours; raw master URLs are never exposed. Downloads recheck payment status, so reversed payments and revoked orders cannot download again.

Checkout callbacks need their original HTTP-only proof to obtain a token. A reference alone grants no access. A customer in another browser uses their emailed link. Recovery sends only to the stored purchase email and returns an uninformative response. Book endpoints use existing persistent rate limits, origin checks and no-store headers. Download links are bearer credentials: anyone given a valid link can use it during its lifetime. Stamping discourages redistribution, but it cannot prevent sharing a downloaded PDF.

## Verification limits for this implementation

Production migration and private master upload were completed on 12 October 2026. Production signing secret and sales activation flag were configured in Vercel. Browser fallback was used after the Vercel plugin scope error. Payment and email delivery still require a complete purchase check; unit tests and database checks do not replace that check. Feature branches do not deploy automatically in this repository; only `main` does.
