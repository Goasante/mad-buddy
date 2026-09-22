# Mad Buddy interaction feedback

This is the product contract for tactile/visual feedback across PWA and future Capacitor builds.

## Platform rule

Call product **intent**, never a platform primitive directly:

```ts
feedback.selection();
feedback.light();
feedback.wave();
feedback.success();
feedback.achievement();
feedback.importantSuccess();
feedback.warning();
feedback.error();
feedback.longPress();
feedback.snap();
```

`lib/feedback/feedback.ts` owns the semantic product vocabulary and native-bridge event. `lib/device/haptics.ts` remains the canonical low-level browser Vibration API adapter. New product surfaces should never call `navigator.vibrate` directly.

- **iPhone PWA:** no general browser vibration API. Keep the visual response; the feedback call safely no-ops for vibration.
- **Android PWA:** use the restrained Vibration API pattern when supported through the shared device adapter.
- **Future Capacitor iOS/Android:** listen for the cancelable `mad-buddy:feedback` event, fire the native haptic, then call `preventDefault()` so browser vibration cannot double-fire.
- Never gate success, navigation, or server state on feedback support. Feedback is an enhancement only.
- Never vibrate from a hidden/background page.

## Approved feedback map

| Product moment | Semantic feedback | Visual treatment | Notes |
| --- | --- | --- | --- |
| Tab/filter/reaction selection | `selection` | tiny scale/pop | Do not use for ordinary scrolling. |
| Lightweight confirmation | `light` | quick press/compression | Small, reversible actions only. |
| Wave sent / live Wave received | `wave` | hand/bounce/pulse | More expressive than selection, lighter than achievement. |
| Plan created / RSVP saved / request accepted | `success` | short spring/check | Use only after the server confirms success. |
| Achievement unlocked | `achievement` | badge burst + orange glow | Show once for the newly-created achievement row. |
| Safe Arrival confirmed | `importantSuccess` | stronger success ring | Strong positive acknowledgement, never a repeating alarm. |
| Destructive/attention confirmation | `warning` | compact nudge | Before or after an explicit consequential action as appropriate. |
| Failed send / refused action / mutation failure | `error` | short shake | Only after a real failure; never while an action is merely pending. |
| Context menu successfully opened from hold | `longPress` | scale-in lock | Fire when the hold threshold is reached, not on pointer-down. |
| Drag/carousel/slider snap point | `snap` | snap motion | Use at meaningful snap points, not every pixel. |

## Places that should stay quiet

Do **not** add feedback to ordinary page navigation, scrolling, typing, every bottom-navigation tap, back buttons, background refreshes, or passive loading. Mad Buddy should feel responsive, not constantly buzzy.

## Achievement behavior

Achievement granting remains owned by `user_achievements` and the canonical achievement catalog. A new row creates the existing `achievement:<code>` notification once; the live signal layer turns that new notification into the foreground celebration.

The celebration uses the real catalog badge artwork, `Achievement unlocked`, the achievement name, and the canonical description. Tapping it opens `/badges`. Database uniqueness plus live-signal notification identity prevents refresh/reconnect from replaying an already-seen unlock as a fresh celebration.

## Current rollout

This tranche wires the shared feedback layer into live Achievement/Wave celebrations and the Muddy profile Wave action. Additional action surfaces should consume the same semantic API rather than adding their own vibration code.

There are older messaging surfaces in the repository that predate this contract and still contain local vibration helpers. They are existing technical debt, not a pattern to copy; migrate them to the shared adapter/semantic layer when those surfaces are next touched.
