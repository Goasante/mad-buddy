# Illustrated Now SmartCard

The web Home SmartCard now uses a warm, compact surface with its headline and supporting text on the left, a scenario illustration on the right, and a clear primary action below. Metadata, social proof, secondary actions and progress remain readable beneath the headline. Dark mode has a matching neutral surface; safety states use a restrained treatment.

## Artwork

A reusable neutral illustration set replaces the human scenes after review found malformed hands and props, and characters that could be mistaken for a named person. All 58 approved scenarios map explicitly to one of 16 illustration families in `lib/smart-card/artwork.ts`. The compressed 1024px WebP atlas is approximately 60KB. Birthdays use a cupcake and gift; connections use links; nearby states use glowing circles; safety uses shields; commitments use calendars. No names, gender or photos determine decorative artwork.

Named Muddy birthday, single nearby Muddy, and mutual Linkr cards show a small identity avatar beside the display name. Missing or broken images use the existing initials fallback. Birthday avatar data is included only after the existing birthday-delivery, active-friendship, sharing, block, ghost and deletion checks pass. Existing Linkr and proximity photo projections supply their own viewer-authorized identities. Aggregate nearby cards do not show a single person's avatar as though it represents everyone.

## Behavior boundaries

SmartCard selection, ranking, history, cooldowns, feature availability, expiry refresh and acknowledgement remain unchanged. Existing navigation, message creation, pending states and action errors remain connected to their existing handlers. No database migration or feature toggle changes are required. The separate activation card and its arbitration remain unchanged. Existing UpFor imagery is not globally replaced by these SmartCard assets.

## Review

`/dev/smart-card-review` is available only in a Vercel preview deployment. It displays all 58 artwork viewports and sample cards covering narrow screens, long copy, metadata, secondary actions, safety states, birthdays and progress in light and dark mode. Its action capture prevents the visual samples from writing data. Production returns 404 for this route.

Focused tests cover complete artwork mapping, valid viewport bounds and files, safety artwork, unchanged input data, existing action contracts and feature availability. Release validation also includes TypeScript, lint, CI builds and browser review.
