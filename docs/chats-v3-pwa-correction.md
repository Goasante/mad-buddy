# Chats v3 PWA correction

This note records the production issue reported after the first Chats v3 release.

## Voice gesture defect

The v3 composer changed render branches as soon as microphone capture entered `requesting_permission` or `recording`. The pointer handlers that owned release/cancel/lock lived on the idle mic button, so that button could unmount before `pointerup`. Installed PWAs make this especially visible because the first microphone permission dialog interrupts the original press gesture.

Correction requirements:
- first microphone permission may interrupt the gesture without trapping the composer;
- pointer tracking must survive the mic button being replaced;
- release sends after a valid hold;
- left cancels;
- up locks;
- a visible send action exists while recording as a recovery/direct action;
- locked capture continues without holding and sends explicitly;
- permission-grant bootstrap returns to a clear ready state when the original press was interrupted.

## Attachment discoverability

The production picker exposed only photo library and camera. The approved product direction keeps future video visible in the attachment architecture even while upload/storage support is deferred. The corrected picker should use an attachment `+` affordance and a richer sheet/menu, with unsupported durable types clearly marked as later rather than silently absent or falsely functional.
