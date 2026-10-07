-- Retire UpFor and Plans as editorial feature tags in favor of Meetups.
-- Existing article text is preserved; only the structured feature taxonomy changes.
update public.blog_posts
set draft = jsonb_set(draft, '{feature}', '"meetups"'::jsonb, false)
where draft->>'feature' in ('upfor', 'plans');

update public.blog_posts
set published = jsonb_set(published, '{feature}', '"meetups"'::jsonb, false)
where published is not null and published->>'feature' in ('upfor', 'plans');

update public.blog_revisions
set draft = jsonb_set(draft, '{feature}', '"meetups"'::jsonb, false)
where draft->>'feature' in ('upfor', 'plans');

update public.blog_revisions
set published = jsonb_set(published, '{feature}', '"meetups"'::jsonb, false)
where published is not null and published->>'feature' in ('upfor', 'plans');

create or replace function public.save_blog_post(
  p_id uuid,
  p_version integer,
  p_draft jsonb,
  p_intent text,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_post public.blog_posts;
  result public.blog_posts;
begin
  if p_intent not in ('save', 'publish', 'unpublish') or p_intent is null then
    raise exception 'Invalid action';
  end if;
  if p_actor is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'Invalid article';
  end if;
  if p_intent = 'publish' and (
    coalesce(length(p_draft->>'title'), 0) < 3
    or coalesce(length(p_draft->>'description'), 0) < 40
    or coalesce(length(p_draft->>'body'), 0) < 300
    or coalesce(length(p_draft->>'audience'), 0) = 0
    or coalesce(length(p_draft->>'searchIntent'), 0) = 0
    or coalesce(p_draft->>'feature', '') not in ('linkr', 'meetups', 'muddies')
  ) then
    raise exception 'Article is not ready to publish';
  end if;

  if p_id is null then
    if p_intent <> 'save' then raise exception 'Save the draft first'; end if;
    insert into public.blog_posts(slug, draft, updated_by)
    values(p_draft->>'slug', p_draft, p_actor)
    returning * into result;
  else
    select * into current_post from public.blog_posts where id = p_id for update;
    if not found then raise exception 'Article not found'; end if;
    if current_post.version <> p_version then raise exception 'Version conflict: reload before saving'; end if;
    if current_post.slug <> p_draft->>'slug' then raise exception 'The shareable URL cannot change after the first save'; end if;

    insert into public.blog_revisions(post_id, version, draft, published)
    values(current_post.id, current_post.version, current_post.draft, current_post.published);

    update public.blog_posts
    set draft = p_draft,
        published = case when p_intent = 'publish' then p_draft when p_intent = 'unpublish' then null else published end,
        published_at = case when p_intent = 'publish' then coalesce(published_at, now()) else published_at end,
        published_updated_at = case when p_intent = 'publish' then now() else published_updated_at end,
        version = version + 1,
        updated_at = now(),
        updated_by = p_actor
    where id = p_id
    returning * into result;
  end if;

  return jsonb_build_object('id', result.id, 'version', result.version, 'live', result.published is not null);
end;
$$;

revoke all on function public.save_blog_post(uuid, integer, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.save_blog_post(uuid, integer, jsonb, text, uuid) to service_role;
