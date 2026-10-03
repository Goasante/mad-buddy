insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('journal-images','journal-images',false,204800,array['image/jpeg'])
on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='journal-images' and (public or file_size_limit <> 204800 or allowed_mime_types <> array['image/jpeg'])) then
    raise exception 'Journal bucket has unexpected settings';
  end if;
end $$;

create table public.blog_images (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check(width between 1 and 1600),
  height integer not null check(height between 1 and 1200),
  bytes integer not null check(bytes between 1 and 204800),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table public.blog_images enable row level security;
revoke all on public.blog_images from public,anon,authenticated;
grant select,insert on public.blog_images to service_role;

-- Only a reference in the CURRENT published snapshot makes an image public.
-- Drafts, previous revisions, and unreferenced uploads do not qualify.
create function public.blog_image_is_published(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from public.blog_posts where published is not null and (
      published->'cover'->>'id' = p_id::text or
      ((published->'images') @> jsonb_build_array(jsonb_build_object('id',p_id::text))
        and position('[[image:' || p_id::text || ']]' in published->>'body') > 0)
    )
  );
$$;
revoke all on function public.blog_image_is_published(uuid) from public,anon,authenticated;
grant execute on function public.blog_image_is_published(uuid) to service_role;
