-- Pinned conversations (Messages → "Pinned" strip).
--
-- A per-user preference: which of a user's own conversations they've pinned to
-- the top of Messages. Purely cosmetic ordering — no message content, no new
-- access. A user can only pin a conversation they are a joined member of; that
-- membership check runs in the server action under the service role before any
-- write, so no insert/update/delete grant is given to clients here.

create table if not exists public.conversation_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists conversation_pins_user_idx on public.conversation_pins(user_id);

alter table public.conversation_pins enable row level security;

-- An owner may read their own pins directly (the loader reads them server-side
-- with the service role; a direct client read stays scoped to the owner).
drop policy if exists "own conversation pins readable" on public.conversation_pins;
create policy "own conversation pins readable" on public.conversation_pins
  for select using (auth.uid() = user_id);

revoke insert, update, delete on table public.conversation_pins from anon, authenticated;
