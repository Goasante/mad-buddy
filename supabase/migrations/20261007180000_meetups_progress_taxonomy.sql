-- Keep achievement codes stable while moving current product language to Meetups.
-- Historical rows remain valid; retired standalone Safe Arrival watcher/contact
-- achievements stop being advertised as currently earnable.

update public.achievement_definitions
set name = 'First Meetup',
    description = 'You completed your first Meetup.'
where code = 'first_plan';

update public.achievement_definitions
set name = 'Meetup Maker',
    description = 'You completed 5 Meetups.'
where code = 'plan_maker';

update public.achievement_definitions
set name = 'Meetup Regular',
    description = 'You completed 10 Meetups.'
where code = 'plan_regular';

update public.achievement_definitions
set name = 'Open to Meetups',
    description = 'You opened nearby discovery for the first time.'
where code = 'open_to_plans';

update public.achievement_definitions
set description = 'You completed a Meetup safety check-in.'
where code = 'good_check_in';

update public.achievement_definitions
set description = 'You completed 5 Meetup safety check-ins.'
where code = 'safe_traveller';

update public.achievement_definitions
set name = 'Safety Contact',
    description = 'You added someone you trust for safety updates.',
    is_active = false
where code = 'trusted_contact';

update public.achievement_definitions
set name = 'Reliable Buddy',
    description = 'You helped with 5 safety check-ins.',
    is_active = false
where code = 'reliable_watcher';
