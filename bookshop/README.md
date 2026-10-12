# Standalone bookshop

This directory builds independently of Mad Buddy. Only the sample PDF, cover, social card and author portrait are public. The full PDF remains in the existing private Supabase `book-files/ma-prospecting/v1.pdf` object. Purchase records remain in the service-only `book_orders` table.

## Netlify settings

Connect this repository, set the base directory to `bookshop`, build command to `npm run build`, and publish directory to `.next`. Root `netlify.toml` records these settings. Netlify installs the maintained Next.js adapter automatically. Keep branch deployments and deploy previews disabled; production is the only public deployment.

Use `NEXT_PUBLIC_APP_URL=https://books.mad-buddy.com`. Configure the server-only Supabase service role, Paystack secret, Resend key, authorised sender and a random `BOOK_DOWNLOAD_SECRET` of at least 32 characters. Leave `BOOK_SALES_ENABLED=false` until the provider credentials, custom hostname, private PDF and delivery checks are complete. Never put secrets in Git or `NEXT_PUBLIC_*` variables.

## Cutover order

1. Deploy with purchases closed, verify rendering, the sample and access headers.
2. Add `books.mad-buddy.com` as a Netlify custom domain. Add the DNS-only CNAME in the existing Cloudflare zone using the exact target returned by Netlify. Verify HTTPS before activating purchases.
3. Configure payment and email secrets securely in Netlify. The shared merchant webhook becomes `https://books.mad-buddy.com/api/paystack/webhook`. This handles book events locally and forwards other signed events unchanged to the existing Mad Buddy webhook, preserving app subscription handling.
4. Verify payment, callback proof, personalised download, email receipt and recovery. Real purchases require the owner's payment authorisation; use Paystack test mode in a protected isolated test environment when no money should move.
5. Stop new book checkouts on Vercel. Check for in-flight purchases before retiring old routes. Existing buyer links may need fresh recovery links if the signing secret changes; never discard purchase records.
6. Redirect the original book landing page and sample to the verified Netlify hostname. Remove Vercel book fulfilment only after the new webhook and all existing paid-order access are confirmed.

The migration is not complete simply because this project builds. Do not disable the working Vercel book routes before the new host and payment/delivery flow are verified.

## Checks

Run `npm ci`, `npm run typecheck`, `npm test` and `npm run build` in this directory. New webhook tests check book/app routing, unchanged signed payload forwarding and retries on delivery failure. Existing book tests check payment metadata, amount, currency, environment, proof cookies and stamped PDF generation.
