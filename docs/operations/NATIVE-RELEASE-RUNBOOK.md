# Native Android / iOS Release Runbook

Mad Buddy's native apps are Capacitor clients around a bundled Vite SPA. They share backend/server authority with the web product but have separate platform signing, permissions, OAuth, push, and store-release concerns.

## Native identity

- Capacitor app id: `com.madbuddy.app`
- Android application id: `com.madbuddy.app`
- iOS bundle id: `com.madbuddy.app`
- Display name: Mad Buddy

## Bundle architecture

The native binary bundles `mobile/dist` and loads local application assets. There is intentionally no remote `server.url` in Capacitor config.

The bundled client talks over HTTPS to:

- Supabase using public/publishable client configuration,
- the deployed web application's `/api/*` routes.

Server secrets must never enter the native bundle.

## Native environment

`mobile/.env.example` documents the public bundle variables:

```text
VITE_API_BASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_TURNSTILE_SITE_KEY
```

Everything under `VITE_*` is inspectable by the user and must be treated as public.

## Android

Current source checkpoint:

- package id: `com.madbuddy.app`
- `versionCode 2`
- `versionName 1.0.1`

### Signing

`android/app/build.gradle` loads release signing from gitignored `keystore.properties` only when present.

Never commit:

- `*.jks`
- `*.keystore`
- `keystore.properties`
- store/key passwords

Before first Play release, the founder/operator must record:

- Play Console app owner,
- Play App Signing status,
- upload key owner,
- protected backup location,
- key alias,
- where passwords live in the private vault,
- recovery process if upload key is lost.

Increase `versionCode` on every store release. Android will reject an equal/lower code as an upgrade.

### Firebase

`android/app/google-services.json` is a local/CI build input and is excluded by the root `.gitignore`.

The server-side Firebase Admin credential is **not** this file; native push delivery uses server-only `FIREBASE_SERVICE_ACCOUNT_BASE64`.

## iOS

The Xcode project uses bundle id `com.madbuddy.app`.

Before first App Store release, record:

- Apple Developer Team ID,
- Account Holder,
- backup Admin,
- App Store Connect app record,
- signing style/profile ownership,
- APNs key/certificate ownership,
- recovery process.

Do not commit `.p12`, `.p8`, `.mobileprovision`, certificate exports, or release export configuration containing sensitive signing material.

`ios/App/App/GoogleService-Info.plist` is a local/CI build input and is excluded by the root `.gitignore`.

## Permissions/privacy

Current native manifests include location permission descriptions for the explicit "Share my location" proximity flow.

Before adding any permission:

1. identify the product feature requiring it,
2. ensure permission is requested contextually rather than at launch unless unavoidable,
3. ensure store privacy declarations match real usage,
4. ensure the app still respects Mad Buddy's no-exact-location-to-other-users invariant.

Background location requires a separate product/policy justification and must not be added simply because Safe Arrival exists.

## OAuth and deep links

Web Google OAuth currently routes through Supabase. Native Google sign-in requires platform-specific configuration and should not rely on embedded-WebView OAuth behavior.

Record and verify before native launch:

- web OAuth client,
- Android OAuth client + package id + SHA fingerprints,
- iOS OAuth client + bundle id / URL scheme,
- Supabase allowed redirect URLs,
- Android App Links,
- iOS Universal Links,
- invitation/Plan/Event/profile/notification/password-recovery callback handling.

## Push notifications

Two push systems exist conceptually:

- web push via VAPID,
- native push via Firebase Admin / FCM and APNs.

Native release proof must cover:

- permission prompt timing,
- token registration,
- token refresh,
- logout/device removal,
- foreground notification behavior,
- background tap/deep-link behavior,
- revoked permission,
- multi-device accounts,
- APNs/FCM production credentials.

Never place `FIREBASE_SERVICE_ACCOUNT_BASE64` in the mobile bundle.

## Native behavior gate

Before store submission, prove on real devices where possible:

- safe areas/notches/Dynamic Island,
- status bar appearance,
- Android system back behavior,
- iOS swipe-back/navigation,
- keyboard avoidance in auth/profile/messages/forms,
- cold start/warm start/resume/background,
- network loss/reconnect,
- session expiry/refresh,
- OAuth return,
- deep-link cold launch,
- camera/photo/microphone permissions,
- push notification tap paths,
- reduced motion/accessibility and text scaling.

## Store release sequence

1. Pin exact source SHA.
2. Build the current bundled mobile SPA.
3. Sync Capacitor native projects.
4. Verify public-only native environment.
5. Verify platform signing identity.
6. Increment platform version/build numbers.
7. Build signed release artifact.
8. Install on real device and run native behavior gate.
9. Upload to internal/test track first.
10. Verify store metadata/privacy declarations/screenshots.
11. Promote only after exact build is approved.
12. Record source SHA, native version/build, signing identity, store release id, and rollback/previous build.

## Never do this

- Never ship a service-role/database/provider private credential inside APK/IPA/JS.
- Never rely on obscurity/minification as authorization.
- Never redesign core web product independently per platform without an explicit product decision.
- Never rotate signing credentials casually without understanding store recovery consequences.
- Never claim native launch complete based only on a successful simulator build.
