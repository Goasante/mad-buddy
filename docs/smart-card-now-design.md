# Illustrated Now SmartCard

The web Home SmartCard now uses a warm surface with a clear primary action below. The illustration stays to the right of the copy at every screen width. On phones, the illustration receives 57.5% of the space beside the headline, with a separate gap from the text. Supporting copy runs across the card underneath that row so it stays readable. Wider screens give the illustration up to 18rem and keep the copy to its left. The artwork has its own padded 4:3 space and uses object-contain to preserve the whole scene without cropping. Metadata, social proof, secondary actions and progress remain readable beneath the headline. Dark mode has a matching neutral surface; safety states use a restrained treatment.

## Artwork

All 58 approved scenarios map to distinct transparent illustrations in `lib/smart-card/artwork.ts`. General social moments retain warm human editorial scenes. Cards about a watcher, requester, connection, birthday person, or other individual use relevant activities and objects, so a decorative character does not imply that person's gender or identity. Glow uses the approved scene of friends meeting. Names and inferred gender never choose artwork.

The illustrations float directly on the card surface without ivory boxes. Production WebPs are at most 720px wide, preserve alpha, and total about 4.3MB across all 58 assets (about 74KB per scenario). Only the selected card image loads on Home. The original source PNGs are not shipped.

Named Muddy birthday, single nearby Muddy, and mutual Linkr cards show a small identity avatar beside the display name. Missing or broken images use the existing initials fallback. Birthday avatar data is included only after the existing birthday-delivery, active-friendship, sharing, block, ghost and deletion checks pass. Existing Linkr and proximity photo projections supply their own viewer-authorized identities. Aggregate nearby cards do not show a single person's avatar as though it represents everyone.

## Behavior boundaries

SmartCard selection, ranking, history, cooldowns, feature availability, expiry refresh and acknowledgement remain unchanged. Existing navigation, message creation, pending states and action errors remain connected to their existing handlers. No database migration or feature toggle changes are required. The separate activation card and its arbitration remain unchanged. Existing UpFor imagery is not globally replaced by these SmartCard assets.

## Review

`/dev/smart-card-review` is available in local development and Vercel preview deployments. It displays all 58 artwork viewports and sample cards covering narrow screens, long copy, metadata, secondary actions, safety states, birthdays and progress in light and dark mode. Its action capture prevents the visual samples from writing data. Production returns 404 for this route.

Focused tests cover complete and unique artwork mapping, existing production files, safety artwork, unchanged input data, existing action contracts and feature availability. Release validation also includes TypeScript, lint and CI builds. Browser review is attempted where the runtime allows access to the development server.
