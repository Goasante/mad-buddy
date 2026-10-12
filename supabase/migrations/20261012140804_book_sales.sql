-- Isolated, service-only book purchases. Buying a book grants no app entitlement.
create table public.book_orders (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product = 'ma_prospecting_playbook_v1'),
  reference text not null unique,
  email text not null check (length(email) between 3 and 254),
  amount_minor integer not null check (amount_minor = 20000),
  currency text not null check (currency = 'GHS'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'revoked')),
  browser_proof_hash text not null check (browser_proof_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  receipt_sent_at timestamptz
);
create index book_orders_paid_email_idx on public.book_orders(email, created_at desc) where status = 'paid';
alter table public.book_orders enable row level security;
revoke all on public.book_orders from public, anon, authenticated;
grant select, insert, update, delete on public.book_orders to service_role;
create policy book_orders_server_only on public.book_orders for all to service_role using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-files', 'book-files', false, 2097152, array['application/pdf'])
on conflict (id) do nothing;

-- RESTRICTIVE policies protect this bucket even if an older permissive policy
-- covers all authenticated storage objects. Service role remains the sole reader.
create policy book_files_private_select on storage.objects as restrictive for select to anon, authenticated using (bucket_id <> 'book-files');
create policy book_files_private_insert on storage.objects as restrictive for insert to anon, authenticated with check (bucket_id <> 'book-files');
create policy book_files_private_update on storage.objects as restrictive for update to anon, authenticated using (bucket_id <> 'book-files') with check (bucket_id <> 'book-files');
create policy book_files_private_delete on storage.objects as restrictive for delete to anon, authenticated using (bucket_id <> 'book-files');
