-- Smart Card Engine: per-user acknowledgement of a dismissible Smart Card.
--
-- Home shows exactly one Smart Card, chosen server-side from an ordered
-- provider list. Most cards are driven purely by derived state and vanish on
-- their own once that state changes (the Journey card disappears when the
-- Journey advances). A few have no such natural end — "Journey Complete" is
-- true forever once earned — so they stay active until the user acknowledges
-- them, and this table is that acknowledgement.
--
-- One row per user per card, enforced by the database rather than app code:
-- acknowledging twice is a no-op, so the write path can be a blind upsert.
create table if not exists public.smart_card_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Not a foreign key and not a check-constrained enum: card ids live in
  -- application code and new cards ship without a migration. An id that is
  -- retired later simply stops being read.
  card_id text not null check (char_length(card_id) between 3 and 64),
  acknowledged_at timestamptz not null default now(),
  constraint smart_card_acknowledgements_unique unique (user_id, card_id)
);

-- The only read is "which cards has this user acknowledged", by user.
create index if not exists smart_card_acknowledgements_user_idx
  on public.smart_card_acknowledgements(user_id);

alter table public.smart_card_acknowledgements enable row level security;

create policy "users read own smart card acknowledgements"
  on public.smart_card_acknowledgements for select
  using (auth.uid() = user_id);

-- Acknowledging is a genuine user action, so unlike the Buddy Score ledger
-- the client may insert -- but only ever for itself.
create policy "users acknowledge own smart cards"
  on public.smart_card_acknowledgements for insert
  with check (auth.uid() = user_id);
