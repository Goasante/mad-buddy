# Illustrated Now SmartCard

The web Home SmartCard now uses a warm, compact surface with its headline and supporting text on the left, a scenario illustration on the right, and a clear primary action below. Metadata, social proof, secondary actions and progress remain readable beneath the headline. Dark mode has a matching neutral surface; safety states use a restrained treatment.

## Artwork

The five approved illustration review sheets are compressed WebP assets under `public/illustrations/smart-card/`. Native SVG viewports show the artwork without the review-sheet captions. `lib/smart-card/artwork.ts` maps every one of the 58 approved catalog scenarios to its viewport. Existing runtime providers select only the scenarios they already support: this presentation change does not activate future scenarios or optional features. Safe Arrival distinguishes an overdue check-in from an active journey. Illustrations describe a moment rather than the appearance of a named person.

## Behavior boundaries

SmartCard selection, ranking, history, cooldowns, feature availability, expiry refresh and acknowledgement remain unchanged. Existing navigation, message creation, pending states and action errors remain connected to their existing handlers. No database migration or feature toggle changes are required. The separate activation card and its arbitration remain unchanged. Existing UpFor imagery is not globally replaced by these SmartCard assets.

## Review

`/dev/smart-card-review` is available only in a Vercel preview deployment. It displays all 58 artwork viewports and sample cards covering narrow screens, long copy, metadata, secondary actions, safety states, birthdays and progress in light and dark mode. Its action capture prevents the visual samples from writing data. Production returns 404 for this route.

Focused tests cover complete artwork mapping, valid viewport bounds and files, safety artwork, unchanged input data, existing action contracts and feature availability. Release validation also includes TypeScript, lint, CI builds and browser review.
