# Linkr Tranche 2 — architecture note (Phase 0)

Written **before** any lifecycle change, per the tranche brief. Records what
already exists so this work extends single authorities instead of creating
second ones.

Base: `origin/main` @ `4cd05ec`, plus the two approved Linkr commits
(heart→wave, hide→blocked list).

## Authorities found

| Concern | Authority | Verdict |
|---|---|---|
| Decisions (pass/connect) | `public.linkr_actions` — unique `(actor_id, target_id)`, nullable `expires_at` | **Exists, sufficient** |
| Mutual edge | `public.linkr_connections` — ordered pair `(user_low < user_high)` + unique, carries `conversation_id`, `ended_at` | **Exists, sufficient** |
| Reciprocity | `public.linkr_record_connect` RPC, SECURITY DEFINER, `service_role` only, advisory-xact-lock on the pair | **Exists, race-safe — do not touch** |
| Candidate suppression | `candidate-service.ts` — one batched query per fact; excludes on blocks (bidirectional), live actions, existing connections | **Exists** |
| Notifications | `public.notifications` (`user_id,type,title,message,is_read`) — **no payload/entity column** | Exists; destination is encoded in `type` |
| Destination routing | `lib/notifications/destination.ts` — `"<base>:<id>"` convention | Exists; `linkr_connection` **absent** |
| Conversation | `getOrCreateDirectConversation` (messaging owns it); Linkr calls it via `ensureConnectionConversation` | **Exists — do not duplicate** |
| Card media | `lib/linkr/media-projection.ts` — projection of Profile media, `MAX_LINKR_CARD_PHOTOS = 4` | **Exists** |

## Answers to the Phase 0 questions

- **What suppresses a candidate after Pass?** A `linkr_actions` row with
  `expires_at = now() + PASS_DURATION_MS`. `PASS_DURATION_MS` is **already
  30 days** (`connection-service.ts:31`) — the brief's requested value, so
  nothing to change. "Don't show me again" writes `expires_at = NULL`.
- **After Connect?** The same row with `action='connect'` and
  `expires_at = NULL` (the RPC nulls it explicitly), so interest never lapses.
- **Can an action expire?** Yes — `expires_at`, filtered at read time in
  `candidate-service.ts` rather than trusted to a cleanup job.
- **How is reciprocity detected?** Only inside `linkr_record_connect`. No
  application code may read both sides of `linkr_actions`.
- **Is one connection row guaranteed?** Yes — ordered pair + unique constraint
  + advisory lock. Verified by `connect-race-migration.test.ts`.
- **How does each client learn reciprocity happened?** **This is the gap.** The
  RPC returns `matched` to *the caller only*. The second connector learns
  synchronously; the first connector has no signal at all until a page load.
- **How are notification destinations represented?** As the `type` string,
  `"<base>:<id>"`. There is no separate destination column.
- **How is the canonical direct conversation located?**
  `linkr_connections.conversation_id`, filled by `getOrCreateDirectConversation`.
- **Does a Clicked/connections collection exist?** **No.** Linkr views are
  `discover | filters | profile | settings | how | event-intro`.
  `loadConnectionContext` answers one pair, not a list.
- **Where do candidate photos come from?** The Profile projection: avatar at
  index 0 + up to three `profile_photos` — but only `visibility = 'everyone'`.

## What is already correct (do not rebuild)

1. **Pass Undo** — `undoLastLinkrAction` exists: most recent action only,
   5-minute window, refuses to undo a formed connection.
2. **Pass cooldown** — already 30 days, the requested value.
3. **One-sided privacy** — the RPC returns one bit; no notification is written
   on the unmatched path.
4. **Idempotent notify** — gated on the DB's own `created` flag, so exactly one
   caller notifies.
5. **Multi-photo card** — `candidate-card.tsx` already has tap-zone browsing,
   progress segments and keyboard nav; the projection already resolves 4 images.

## Real defects to fix

- **D1 — first connector never learns (brief §6/§8).** The RPC tells only the
  caller. A gets a notification row but no in-Linkr signal.
- **D2 — mutual notification is unroutable (§10).** `linkr_connection` is not
  in `DESTINATION_BY_BASE`, so tapping it goes nowhere. It also carries no
  name and no id.
- **D3 — no Clicked surface (§13/§14).** Mutual people are removed from
  Discover and then unreachable inside Linkr.
- **D4 — no "Your clicks" (§4).** A loses sight of people A chose.
- **D5 — showcase photos invisible on cards (§15).** *Not a pipeline bug.*
  `profile_photos.visibility` **defaults to `approved_muddies`**, while the
  Linkr projection admits only `everyone`. The projection is correct and must
  stay correct: a photo kept for Muddies must not be handed to strangers.
  This is a **product/consent decision, not a code fix** — see Risks.
- **D6 — Undo ordering.** `undoLastLinkrAction` orders by `created_at`, but an
  upsert on a re-decided candidate only bumps `updated_at`. Re-deciding
  someone old then undoing removes the wrong row.

## Decisions

- **No new action authority.** Pending/mutual/passed are *derived* from
  `linkr_actions` + `linkr_connections`, not stored again.
- **No new notification system.** Reuse `notifications` + the `type` convention.
- **No new conversation path.** Say hi keeps delegating to messaging.
- **Migration:** avoided where possible. Nothing here needs a schema change:
  every new state is derivable from existing rows.
