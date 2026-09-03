# Staging data foundation

Deterministic synthetic data for a **staging** Supabase project: enough to run
the R1–R8 Messaging runtime proofs, device testing, and a 10 → 100 user load
ramp against something other than empty tables.

Mad Buddy has ~7,700 unit tests and, before this, no integration/runtime data
layer at all. This is the first piece of that layer.

## What it creates

| Dataset | Count | Purpose |
| --- | --- | --- |
| Auth users + profiles | 100 | `staging-user-001` … `staging-user-100` |
| Buddy edges | 302 | ring + chords; nobody isolated, not fully connected |
| Direct conversations | 2 | `user001↔user002` (primary), `user001↔user003` (switch target) |
| Primary messages | 420 | R1 long scroll, across multiple days |
| Group conversation | 1 | `user001`(owner) … `user005`; roles, mentions, permissions |
| Attachment fixture | 1 | generated 16×16 PNG |
| Voice fixture | 1 | generated 3s WAV + waveform |
| Chat settings / preferences | non-empty | so R3/R4 reconciliation has real server values |

## What it never touches

- **Production.** Ref `cabkhxxnrybzhkbtoiiz` is hard-blocked in code.
- Any row it does not own. There is no truncate, no reset, no bulk delete.
- Real user data. Every account is `@staging.example.com` (RFC 2606 reserved,
  undeliverable), marked `mad-buddy-staging-fixture`.

## Required environment

Names only — never commit or print the values.

```
NEXT_PUBLIC_SUPABASE_URL            staging project URL
SUPABASE_SERVICE_ROLE_KEY           staging service-role key   (--apply only)
MAD_BUDDY_ALLOW_STAGING_SEED=YES    explicit opt-in            (always)
MAD_BUDDY_STAGING_USER_PASSWORD     synthetic account password (--apply only)
```

## Running it

```bash
npm run seed:staging              # DRY RUN — validates, plans, prints counts
npm run seed:staging -- --apply   # writes
```

Dry run is the default and opens no database connection.

## Production guards

Four independent refusals, checked in this order:

1. **unparseable target** → refuse (an unknown database is never "probably fine")
2. **production ref** → refuse *regardless of every other flag*
3. **missing `MAD_BUDDY_ALLOW_STAGING_SEED=YES`** → refuse
4. **`--apply` without service-role key or password** → refuse

`NODE_ENV` is deliberately **not** a guard: it is trivially wrong in a CI shell
and says nothing about which database the URL points at.

The whole matrix is unit-tested in `lib/staging/safety.test.ts` without a
database, including the case where an operator sets the opt-in flag *and*
points at production.

## Idempotency

Rerunning must never double the dataset. Each set has a natural key:

| Dataset | Key |
| --- | --- |
| Auth users | email, discovered via paged `listUsers` before create |
| Profiles / birth details | `user_id` |
| Friendships | `(user_one_id, user_two_id)`, always ordered `a < b` |
| Conversations (direct) | `direct_key` = sorted `a:b`, matching the SQL |
| Conversations (group) | fixed deterministic `context_id` |
| Members | `(conversation_id, user_id)` |
| Messages | `(conversation_id, client_message_id)` — the app's own dedupe column |
| Media assets | `storage_key` (UNIQUE) |

## Cohorts

Strictly nested prefixes of the same 100 accounts, so a ramp step never seeds a
fresh batch:

```
cohort10 ⊂ cohort25 ⊂ cohort50 ⊂ cohort75 ⊂ cohort100
```

## R1–R8 accounts

| Role | Account |
| --- | --- |
| Primary | `staging-user-001` |
| Secondary | `staging-user-002` |
| Switch target | `staging-user-003` |
| Group members | `staging-user-001` … `005` |

All share `MAD_BUDDY_STAGING_USER_PASSWORD`.

## Manifest

`--apply` writes `staging-manifest.local.json` (gitignored): labels, emails,
usernames, user ids, cohorts, conversation ids. **No** passwords, keys or
tokens.

## Schema notes worth knowing

Learned from the 124 migrations; ignoring these produces a seeder that fails on
first apply:

- `messages.message_type` for voice is **`voice_note`**, not `"voice"`.
- Image and voice messages **require** a `media_id`; a text row with
  `"voice"` in it is not a voice message.
- The media guard (`20260808260000`) requires the asset to have
  `intended_conversation_id` set to the target conversation,
  `processing_status='ready'`, `moderation_status='active'`, no pending
  deletion-queue row, and a `content_type` matching the message type
  (`image/*` vs `audio/*`).
- Storage buckets are `avatars` (public), `media` (private), `wallpapers`.
  Chat media goes in `media`.
- Inserting a `friendships` row **reopens** an archived direct conversation via
  trigger but never creates one — the seeder creates conversations explicitly.
- `friendships` requires `user_one_id < user_two_id`.
