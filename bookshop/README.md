# Standalone bookshop

This directory builds independently of Mad Buddy. Only the sample PDF, cover, social card and author portrait are public. The full PDF remains in the existing private Supabase `book-files/ma-prospecting/v1.pdf` object. Purchase records remain in the service-only `book_orders` table.

## Netlify settings

Connect this repository, set the base directory to `bookshop`, build command to `npm run build`, and publish directory to `.next`. Root `netlify.toml` records these settings and explicitly enables the maintained Next.js adapter. Keep branch deployments and deploy previews disabled; production is the only public deployment.

Use `NEXT_PUBLIC_APP_URL=https://books.mad-buddy.com`. Configure the server-only Supabase service role, Paystack secret, Resend key, authorised sender and a random `BOOK_DOWNLOAD_SECRET` of at least 32 characters. Leave `BOOK_SALES_ENABLED=false` until the provider credentials, custom hostname, private PDF and delivery checks are complete. Never put secrets in Git or `NEXT_PUBLIC_*` variables.

## Cutover order

1. Deploy with purchases closed, verify rendering, the sample and access headers.
2. Add `books.mad-buddy.com` as a Netlify custom domain. Add the DNS-only CNAME in the existing Cloudflare zone using the exact target returned by Netlify. Verify HTTPS before activating purchases.
3. Configure payment and email secrets securely in Netlify. Keep the existing merchant webhook at `https://mad-buddy.com/api/paystack/webhook`: it validates the provider signature and forwards only book events, with their unchanged body and signature, to `https://books.mad-buddy.com/api/paystack/webhook`. App payment events remain in the existing app handler. If the merchant already points at the bookshop endpoint, that endpoint handles books and forwards non-book events back to the app. Verify which endpoint is saved in Paystack; neither path works unless the provider has a webhook URL configured.
4. Verify payment, callback proof, personalised download, email receipt and recovery. Real purchases require the owner's payment authorisation; use Paystack test mode in a protected isolated test environment when no money should move.
5. Redirect Vercel book pages, samples and API routes to the verified Netlify hostname using the root Next.js redirects. Check for in-flight purchases first. Existing buyer links may need fresh recovery links if the signing secret changes; never discard purchase records. A previous checkout's browser proof cookie stays on the old host; those buyers can recover their paid copy by email on the new host.
6. Verify the redirects and signed webhook forwarding on production after merging. Switch Netlify's production branch to `main` so both applications deploy from the maintained branch, while using separate build directories and hosts.

The migration is not complete simply because this project builds. Do not disable the working Vercel book routes before the new host and payment/delivery flow are verified.

## Checks

Run `npm ci`, `npm run typecheck`, `npm test` and `npm run build` in this directory. New webhook tests check book/app routing, unchanged signed payload forwarding and retries on delivery failure. Existing book tests check payment metadata, amount, currency, environment, proof cookies and stamped PDF generation.
