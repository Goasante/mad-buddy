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

`lib/feedback/feedback.ts` owns the semantic product vocabulary. `lib/device/haptics.ts` remains the canonical low-level browser Vibration API adapter. New product surfaces should never call `navigator.vibrate` directly.

- **iPhone PWA:** no general browser vibration API. The interaction keeps its own visual response and the feedback call safely no-ops for vibration.
- **Android PWA:** use the restrained Vibration API pattern when supported through the shared device adapter.
- **Future Capacitor iOS/Android:** the native bootstrap registers a handler through `registerNativeFeedbackHandler()`. The handler starts the native haptic and returns `true`, so browser vibration does not double-fire. This stays inside application modules rather than broadcasting semantic activity as a global DOM event.
- Never gate success, navigation, or server state on feedback support. Feedback is an enhancement only.
- Never vibrate from a hidden/background page.
- Do not create a second global visual overlay just to imitate vibration on iPhone. Each surface owns the visual acknowledgement already attached to the action: state transition, spring/check, toast, badge burst, hold compression, snap motion, or Safe Arrival status animation.

## Approved feedback map

| Product moment | Semantic feedback | Visual treatment | Notes |
| --- | --- | --- | --- |
| Tab/filter/reaction selection | `selection` | tiny scale/pop or selected state | Do not use for ordinary scrolling. |
| Lightweight confirmation | `light` | quick press/state confirmation | Small, reversible actions only. |
| Wave sent / live Wave received | `wave` | hand/bounce/pulse | More expressive than selection, lighter than achievement. |
| Plan created / RSVP saved / request accepted | `success` | existing success transition/check/toast | Use only after the server confirms success. |
| Achievement unlocked | `achievement` | badge burst + orange glow | Show once for the newly-created achievement row. |
| Safe Arrival confirmed | `importantSuccess` | stronger arrival/status success animation | Strong positive acknowledgement, never a repeating alarm. |
| Destructive/attention confirmation | `warning` | compact nudge/state change | Only for a real consequential action. |
| Failed send / refused action / mutation failure | `error` | existing error state/toast | Only after a real failure; never while an action is merely pending. |
| Context menu successfully opened from hold | `longPress` | scale-in lock | Fire when the hold threshold is reached, not on pointer-down. |
| Drag/carousel/slider snap point | `snap` | snap motion | Use at meaningful snap points, not every pixel. |

## Places that should stay quiet

Do **not** add feedback to ordinary page navigation, scrolling, typing, every bottom-navigation tap, back buttons, background refreshes, or passive loading. Mad Buddy should feel responsive, not constantly buzzy.

## Achievement behavior

Achievement granting remains owned by `user_achievements` and the canonical achievement catalog. A new row creates the existing `achievement:<code>` notification once; the live signal layer turns that new notification into the foreground celebration.

The celebration uses the real catalog badge artwork, `Achievement unlocked`, the achievement name, and the canonical description. Tapping it opens `/badges`. Database uniqueness plus live-signal notification identity prevents refresh/reconnect from replaying an already-seen unlock as a fresh celebration.

## Current rollout

The approved feedback map is now wired into the current product surfaces that own these moments:

- live Achievement and incoming Wave celebrations;
- sent Wave, Ping selection, and Wave/message failure feedback from the Muddy profile;
- Plan creation, RSVP, Plan poll selection, poll creation, chat-window save, Plan cancellation, and Plans tab selection;
- Safe Arrival start, watcher acknowledgement, extension, cancellation, mutation failure, and **arrival confirmation with `importantSuccess`**;
- UpFor join request, withdrawal, creation/update, Plan RSVP from UpFor, request accept/decline, end, conversion to Plan, and mutation failure;
- shared long-press context menus plus message-action long press, safe selection, and destructive selection;
- the draggable Quick Actions launcher when it settles onto a screen edge.

All mutation feedback is fired from the confirmed result path, not while a write is merely pending. Background feed refreshes remain quiet.

There are older messaging surfaces in the repository that predate this contract and still contain local vibration helpers. They are existing technical debt, not a pattern to copy; migrate them to the shared adapter/semantic layer when those surfaces are next touched.
