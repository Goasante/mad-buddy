-- Working drafts and historical revisions have no browser/Data API grants.
-- Public Next.js pages deliberately select only published snapshots.
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  draft jsonb not null,
  published jsonb,
  published_at timestamptz,
  published_updated_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((published is null) or (published_at is not null and published_updated_at is not null)),
  check (draft->>'slug' = slug),
  check (published is null or published->>'slug' = slug)
);
create table public.blog_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id),
  version integer not null,
  draft jsonb not null,
  published jsonb,
  saved_at timestamptz not null default now(),
  unique(post_id, version)
);
alter table public.blog_posts enable row level security;
alter table public.blog_revisions enable row level security;
revoke all on public.blog_posts, public.blog_revisions from public, anon, authenticated;
grant select, insert, update on public.blog_posts to service_role;
grant select, insert on public.blog_revisions to service_role;
create index blog_posts_public_date on public.blog_posts(published_at desc) where published is not null;

-- One locked transaction: preserve old content, compare the editor version,
-- and promote a complete draft. Never silently overwrite another browser tab.
create function public.save_blog_post(p_id uuid, p_version integer, p_draft jsonb, p_intent text, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_post public.blog_posts;
  result public.blog_posts;
begin
  if p_intent not in ('save', 'publish', 'unpublish') or p_intent is null then raise exception 'Invalid action'; end if;
  if p_actor is null or jsonb_typeof(p_draft) <> 'object' then raise exception 'Invalid article'; end if;
  if p_intent = 'publish' and (
    coalesce(length(p_draft->>'title'), 0) < 3 or coalesce(length(p_draft->>'description'), 0) < 40
    or coalesce(length(p_draft->>'body'), 0) < 300 or coalesce(length(p_draft->>'audience'), 0) = 0
    or coalesce(length(p_draft->>'searchIntent'), 0) = 0
    or coalesce(p_draft->>'feature', '') not in ('linkr', 'upfor', 'plans', 'muddies')
  ) then raise exception 'Article is not ready to publish'; end if;
  if p_id is null then
    if p_intent <> 'save' then raise exception 'Save the draft first'; end if;
    insert into public.blog_posts(slug, draft, updated_by) values(p_draft->>'slug', p_draft, p_actor) returning * into result;
  else
    select * into current_post from public.blog_posts where id = p_id for update;
    if not found then raise exception 'Article not found'; end if;
    if current_post.version <> p_version then raise exception 'Version conflict: reload before saving'; end if;
    if current_post.slug <> p_draft->>'slug' then raise exception 'The shareable URL cannot change after the first save'; end if;
    insert into public.blog_revisions(post_id, version, draft, published)
      values(current_post.id, current_post.version, current_post.draft, current_post.published);
    update public.blog_posts set
      draft = p_draft,
      published = case when p_intent = 'publish' then p_draft when p_intent = 'unpublish' then null else published end,
      published_at = case when p_intent = 'publish' then coalesce(published_at, now()) else published_at end,
      published_updated_at = case when p_intent = 'publish' then now() else published_updated_at end,
      version = version + 1, updated_at = now(), updated_by = p_actor
      where id = p_id returning * into result;
  end if;
  return jsonb_build_object('id', result.id, 'version', result.version, 'live', result.published is not null);
end;
$$;
revoke all on function public.save_blog_post(uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.save_blog_post(uuid, integer, jsonb, text, uuid) to service_role;
