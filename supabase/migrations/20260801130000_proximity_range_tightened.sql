-- Tighten the canonical nearby-discovery range from ~100km down to 15km and
-- rename the buckets to match the product's Close/Near/Far vocabulary.
--
-- Old bands (meters): very_close <=25_000, nearby <=50_000, around <=100_000,
-- far >100_000 (still returned, muted).
-- New bands (meters): close <=5_000, near <=10_000, far <=15_000; beyond
-- 15_000 is excluded from the nearby response entirely (see
-- lib/proximity/backend.ts), it no longer has a bucket label at all.
--
-- proximity_events is write-only history (see lib/proximity/backend.ts
-- buildSafeNearbyFriends comment) with a 15-minute expires_at TTL and is never
-- read back to serve a request, so existing rows are stale bookkeeping by the
-- time this migration runs in any real deployment window; they are
-- reclassified rather than dropped, to avoid an unnecessary destructive
-- rewrite of history.

-- 1. Rename the two buckets whose meaning is unchanged, just relabeled.
alter type public.proximity_level rename value 'very_close' to 'close';
alter type public.proximity_level rename value 'nearby' to 'near';

-- 2. Postgres enums cannot drop a value in place. Recreate the type without
--    'around', reclassifying any existing 'around' rows as 'far' first (the
--    closest surviving bucket, and the same "not glowing brightly" semantics
--    the old 'around'/'far' bands both carried).
update public.proximity_events set proximity_level = 'far' where proximity_level = 'around';

alter table public.proximity_events
  alter column proximity_level type text using proximity_level::text;

drop type public.proximity_level;

create type public.proximity_level as enum ('close', 'near', 'far', 'hidden');

alter table public.proximity_events
  alter column proximity_level type public.proximity_level using proximity_level::public.proximity_level;
