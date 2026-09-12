# Mobile release configuration

**Status: OPEN.** Android builds currently depend on one developer's machine
having a correct `mobile/.env.local`, which is gitignored. This file records
what must be true of a build, so the gap is explicit until it is closed.

## Why this is a real risk, not housekeeping

The values below are inlined into the bundle by Vite at build time. They are
not read at runtime, so a wrong value cannot be corrected after the fact — it
ships inside the APK and stays there until someone rebuilds.

This has already caused one production-shaped outage. The web app moved to
`mad-buddy.com`; `mad-buddy.vercel.app` began answering `/api/*` with a 307;
the APK still carried the old host. Because a browser will not replay an
`Authorization` header across a cross-origin redirect, **every authenticated
call failed** — notifications, plans, friends, hangouts and push registration.
The app looked signed in and empty. Nothing failed a build, because a URL only
has to parse to be inlined.

## Required values

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://mad-buddy.com` | **Canonical origin.** Must serve `/api/*` directly. No trailing slash. Not `mad-buddy.vercel.app` — it redirects. |
| `VITE_SUPABASE_URL` | project URL | Same project as the web app. |
| `VITE_SUPABASE_ANON_KEY` | publishable key | **Anon/publishable only — never the service role key.** It ships in the binary. |
| `VITE_TURNSTILE_SITE_KEY` | public site key | Its hostname allow-list must include `https://localhost`, the native WebView origin. |

`android/app/google-services.json` must also be present. It is gitignored;
without it a debug build crashes on launch with *"Default FirebaseApp is not
initialized"*, and a release build is configured to fail outright.

## Gates that run today

- `scripts/verify-mobile-api-origin.mjs` — rejects a base URL that redirects
  `/api/*`, and names the origin to use instead. Reads `VITE_API_BASE_URL`
  from the environment first, then `mobile/.env.local` / `mobile/.env`. Expects
  **401** from the probe: the route exists and demands auth. `--offline` (or
  `MOBILE_API_ORIGIN_OFFLINE=1`) keeps only the static checks, which is what CI
  uses since it builds against a placeholder host.
- `scripts/verify-mobile-bundle.mjs` — reads the BUILT bundle for Next.js
  runtime markers and service-role symbols.
- `lib/brand/mobile-asset-parity.test.ts` — every asset referenced by
  `lib/brand/assets.ts` must exist in **both** `public/` and `mobile/public/`.
  Vite copies `mobile/public` verbatim and does not reach into the web app's,
  so a shared component's images must be copied across explicitly.

## What still needs deciding

1. Where the release values live — repo-committed `.env.production` with only
   public values, or CI secrets.
2. Who builds release APKs, and on what machine.
3. Running the **live** origin probe (without `--offline`) in whatever job
   produces a shippable artifact, so a redirecting host cannot ship again.

Until then: anyone building an APK must set `mobile/.env.local` themselves.
`mobile/.env.example` is the authoritative template.
