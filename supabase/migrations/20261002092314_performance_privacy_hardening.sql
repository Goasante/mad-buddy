-- Performance, privacy-retention, and RLS hardening.
-- Derived from the live production policy definitions so newer policy logic is preserved.
-- The only semantic RLS correction is the Event Updates admin scope qualification.

alter policy "global windows visible to signed-in users" on public."access_global_windows"
using (((select auth.uid()) IS NOT NULL))
;

alter policy "access grants visible to the owner" on public."access_grants"
using (((select auth.uid()) = user_id))
;

alter policy "reminder log visible to the owner" on public."access_reminder_log"
using (((select auth.uid()) = user_id))
;

alter policy "deletion request owner reads" on public."account_deletion_requests"
using (((select auth.uid()) = user_id))
;

alter policy "verifications owner read" on public."account_verifications"
using (((select auth.uid()) = user_id))
;

alter policy "activation milestones owner read" on public."activation_milestones"
using (((select auth.uid()) = user_id))
;

alter policy "feedback owner insert" on public."app_feedback"
with check (((select auth.uid()) = user_id))
;

alter policy "feedback owner read" on public."app_feedback"
using (((select auth.uid()) = user_id))
;

alter policy "appeals owner access" on public."appeals"
using (((select auth.uid()) = subject_user_id))
;

alter policy "best buddies owner access" on public."best_buddies"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "blocked users owner access" on public."blocked_users"
using (((select auth.uid()) = blocker_id))
with check (((select auth.uid()) = blocker_id))
;

alter policy "users read own buddy score ledger" on public."buddy_score_ledger"
using (((select auth.uid()) = user_id))
;

alter policy "chat poll votes owner delete" on public."chat_poll_votes"
using (((select auth.uid()) = user_id))
;

alter policy "chat poll votes owner insert" on public."chat_poll_votes"
with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM chat_polls p
  WHERE ((p.message_id = chat_poll_votes.poll_message_id) AND (p.closed_at IS NULL) AND is_conversation_member(p.conversation_id) AND chat_poll_parent_is_live(p.message_id))))))
;

alter policy "check ins owner full access" on public."check_ins"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "check ins readable by event host" on public."check_ins"
using (((context_type = 'event'::text) AND (visibility = ANY (ARRAY['participants'::text, 'selected_muddies'::text])) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = check_ins.context_id) AND (e.host_id = (select auth.uid())))))))
;

alter policy "circle members owner access" on public."circle_members"
using ((EXISTS ( SELECT 1
   FROM friend_circles
  WHERE ((friend_circles.id = circle_members.circle_id) AND (friend_circles.user_id = (select auth.uid()))))))
with check ((EXISTS ( SELECT 1
   FROM friend_circles
  WHERE ((friend_circles.id = circle_members.circle_id) AND (friend_circles.user_id = (select auth.uid()))))))
;

alter policy "close friends owner only" on public."close_friend_relationships"
using (((select auth.uid()) = owner_id))
with check (((select auth.uid()) = owner_id))
;

alter policy "consent logs owner creates" on public."consent_logs"
with check (((select auth.uid()) = user_id))
;

alter policy "consent logs owner reads" on public."consent_logs"
using (((select auth.uid()) = user_id))
;

alter policy "contact match sessions owner access" on public."contact_match_sessions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "content reports insert by reporter" on public."content_reports"
with check (((select auth.uid()) = reporter_id))
;

alter policy "content reports visible to reporter" on public."content_reports"
using (((select auth.uid()) = reporter_id))
;

alter policy "conversation members update own row" on public."conversation_members"
using (((select auth.uid()) = user_id))
with check ((((select auth.uid()) = user_id) AND (role = ( SELECT existing.role
   FROM conversation_members existing
  WHERE ((existing.conversation_id = conversation_members.conversation_id) AND (existing.user_id = conversation_members.user_id)))) AND (status = ( SELECT existing.status
   FROM conversation_members existing
  WHERE ((existing.conversation_id = conversation_members.conversation_id) AND (existing.user_id = conversation_members.user_id))))))
;

alter policy "conversation members visible to members" on public."conversation_members"
using ((((select auth.uid()) = user_id) OR is_conversation_member(conversation_id)))
;

alter policy "own conversation pins readable" on public."conversation_pins"
using (((select auth.uid()) = user_id))
;

alter policy "conversation presence owner delete" on public."conversation_presence"
using (((select auth.uid()) = user_id))
;

alter policy "conversation presence owner insert" on public."conversation_presence"
with check ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
;

alter policy "conversation presence owner update" on public."conversation_presence"
using ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
with check ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
;

alter policy "conversation preferences owner delete" on public."conversation_user_preferences"
using (((select auth.uid()) = user_id))
;

alter policy "conversation preferences owner insert" on public."conversation_user_preferences"
with check ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
;

alter policy "conversation preferences owner read" on public."conversation_user_preferences"
using ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
;

alter policy "conversation preferences owner update" on public."conversation_user_preferences"
using ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
with check ((((select auth.uid()) = user_id) AND is_conversation_member(conversation_id)))
;

alter policy "conversations visible to members" on public."conversations"
using ((EXISTS ( SELECT 1
   FROM conversation_members m
  WHERE ((m.conversation_id = conversations.id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "own custom wallpapers readable" on public."custom_wallpapers"
using (((select auth.uid()) = owner_id))
;

alter policy "deletion audit owner reads" on public."deletion_audit_logs"
using (((select auth.uid()) = user_id))
;

alter policy "device push tokens owner access" on public."device_push_tokens"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "discoverability owner access" on public."discoverability_identifiers"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "own passes deletable" on public."discovery_passes"
using (((select auth.uid()) = user_id))
;

alter policy "own passes insertable" on public."discovery_passes"
with check (((select auth.uid()) = user_id))
;

alter policy "own passes readable" on public."discovery_passes"
using (((select auth.uid()) = user_id))
;

alter policy "own passes updatable" on public."discovery_passes"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "downgrade adjustments owner access" on public."downgrade_adjustments"
using ((EXISTS ( SELECT 1
   FROM subscription_changes c
  WHERE ((c.id = downgrade_adjustments.subscription_change_id) AND (c.user_id = (select auth.uid()))))))
;

alter policy "drop targets creator access" on public."drop_audience_targets"
using ((EXISTS ( SELECT 1
   FROM muddy_drops d
  WHERE ((d.id = drop_audience_targets.drop_id) AND (d.creator_id = (select auth.uid()))))))
;

alter policy "drop unlocks visible to unlocker and creator" on public."drop_unlocks"
using ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM muddy_drops d
  WHERE ((d.id = drop_unlocks.drop_id) AND (d.creator_id = (select auth.uid())))))))
;

alter policy "users read own earned rewards" on public."earned_premium_rewards"
using (((select auth.uid()) = user_id))
;

alter policy "emergency controls authenticated reads" on public."emergency_controls"
using (((select auth.uid()) IS NOT NULL))
;

alter policy "engagement preferences owner access" on public."engagement_preferences"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "entitlement overrides subject read" on public."entitlement_overrides"
using (((subject_type = 'user'::text) AND (subject_id = (select auth.uid()))))
;

alter policy "event admins host manages" on public."event_admins"
using ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_admins.event_id) AND (e.host_id = (select auth.uid()))))))
with check ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_admins.event_id) AND (e.host_id = (select auth.uid()))))))
;

alter policy "event admins readable" on public."event_admins"
using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_admins.event_id) AND (e.host_id = (select auth.uid())))))))
;

alter policy "event announcement reactions visible to room members" on public."event_announcement_reactions"
using ((EXISTS ( SELECT 1
   FROM (event_announcements a
     JOIN event_circle_members m ON ((m.event_circle_id = a.event_circle_id)))
  WHERE ((a.id = event_announcement_reactions.event_announcement_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "event announcements visible to members" on public."event_announcements"
using ((EXISTS ( SELECT 1
   FROM event_circle_members m
  WHERE ((m.event_circle_id = event_announcements.event_circle_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "audience targets host manages" on public."event_audience_targets"
using ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_audience_targets.event_id) AND (e.host_id = (select auth.uid()))))))
with check ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_audience_targets.event_id) AND (e.host_id = (select auth.uid()))))))
;

alter policy "audience targets self readable" on public."event_audience_targets"
using (((target_type = 'user'::text) AND (target_id = (select auth.uid()))))
;

alter policy "event circle group targets visible to members" on public."event_circle_group_targets"
using ((EXISTS ( SELECT 1
   FROM event_circle_members m
  WHERE ((m.event_circle_id = event_circle_group_targets.event_circle_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "event circle invitations visible to invitee" on public."event_circle_invitations"
using (((select auth.uid()) = invited_user_id))
;

alter policy "event circle members visible to members" on public."event_circle_members"
using ((((select auth.uid()) = user_id) OR is_event_circle_owner(event_circle_id)))
;

alter policy "event circles owner full access" on public."event_circles"
using (((select auth.uid()) = owner_id))
with check (((select auth.uid()) = owner_id))
;

alter policy "event circles visible to members" on public."event_circles"
using ((EXISTS ( SELECT 1
   FROM event_circle_members m
  WHERE ((m.event_circle_id = event_circles.id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "linkr opt-in owned by user" on public."event_linkr_opt_ins"
using ((user_id = (select auth.uid())))
with check ((user_id = (select auth.uid())))
;

alter policy "event locations follow event visibility" on public."event_locations"
using ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_locations.event_id) AND (e.status <> 'draft'::text) AND ((e.host_id = (select auth.uid())) OR (e.visibility = ANY (ARRAY['community'::text, 'nearby'::text, 'public'::text])))))))
;

alter policy "event locations host writes" on public."event_locations"
using ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_locations.event_id) AND (e.host_id = (select auth.uid()))))))
with check ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_locations.event_id) AND (e.host_id = (select auth.uid()))))))
;

alter policy "event modes owner access" on public."event_modes"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "event rsvps owner creates own" on public."event_rsvps"
with check (((select auth.uid()) = user_id))
;

alter policy "event rsvps owner reads own" on public."event_rsvps"
using (((select auth.uid()) = user_id))
;

alter policy "event rsvps owner updates own" on public."event_rsvps"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "reactions owned by reactor" on public."event_update_reactions"
using ((user_id = (select auth.uid())))
with check ((user_id = (select auth.uid())))
;

alter policy "event updates authored by host or admin" on public."event_updates"
with check (((author_id = (select auth.uid())) AND ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_updates.event_id) AND (e.host_id = (select auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM event_admins a
  WHERE ((a.event_id = event_updates.event_id) AND (a.user_id = (select auth.uid()))))))))
;

alter policy "event updates edited by author or host" on public."event_updates"
using (((author_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_updates.event_id) AND (e.host_id = (select auth.uid())))))))
with check (((author_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_updates.event_id) AND (e.host_id = (select auth.uid())))))))
;

alter policy "event updates readable" on public."event_updates"
using ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_updates.event_id) AND (e.status <> 'draft'::text) AND ((e.host_id = (select auth.uid())) OR (e.visibility = ANY (ARRAY['community'::text, 'nearby'::text, 'public'::text])))))))
;

alter policy "events host full access" on public."events"
using (((select auth.uid()) = host_id))
with check (((select auth.uid()) = host_id))
;

alter policy "feature flags authenticated reads" on public."feature_flags"
using ((((select auth.uid()) IS NOT NULL) AND (status <> 'archived'::text)))
;

alter policy "friend circles owner access" on public."friend_circles"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "own glow colours readable" on public."friend_glow_colors"
using (((select auth.uid()) = owner_id))
;

alter policy "friend requests sender creates" on public."friend_requests"
with check (((select auth.uid()) = sender_id))
;

alter policy "friend requests visible to participants" on public."friend_requests"
using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id)))
;

alter policy "recaps owner access" on public."friendship_recaps"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "streaks visible to the pair" on public."friendship_streaks"
using ((EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((f.id = friendship_streaks.friendship_id) AND (((select auth.uid()) = f.user_one_id) OR ((select auth.uid()) = f.user_two_id))))))
;

alter policy "friendships participants delete" on public."friendships"
using ((((select auth.uid()) = user_one_id) OR ((select auth.uid()) = user_two_id)))
;

alter policy "friendships visible to participants" on public."friendships"
using ((((select auth.uid()) = user_one_id) OR ((select auth.uid()) = user_two_id)))
;

alter policy "group settings visible to members" on public."group_settings"
using ((EXISTS ( SELECT 1
   FROM conversation_members m
  WHERE ((m.conversation_id = group_settings.conversation_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "public groups discoverable" on public."group_settings"
using (((visibility = 'public'::text) AND ((select auth.uid()) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = group_settings.conversation_id) AND (c.conversation_type = 'group'::text) AND (c.status = 'active'::text))))))
;

alter policy "hangout targets owner access" on public."hangout_audience_targets"
using ((EXISTS ( SELECT 1
   FROM hangout_sessions s
  WHERE ((s.id = hangout_audience_targets.hangout_session_id) AND (s.owner_id = (select auth.uid()))))))
;

alter policy "hangout requests created by requester" on public."hangout_requests"
with check (((select auth.uid()) = requester_id))
;

alter policy "hangout requests self cancel" on public."hangout_requests"
using ((((select auth.uid()) = requester_id) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text]))))
with check ((((select auth.uid()) = requester_id) AND (status = 'cancelled'::text)))
;

alter policy "hangout requests visible to owner and requester" on public."hangout_requests"
using ((((select auth.uid()) = requester_id) OR (EXISTS ( SELECT 1
   FROM hangout_sessions s
  WHERE ((s.id = hangout_requests.hangout_session_id) AND (s.owner_id = (select auth.uid())))))))
;

alter policy "hangout owner full access" on public."hangout_sessions"
using (((select auth.uid()) = owner_id))
with check (((select auth.uid()) = owner_id))
;

alter policy "muddies read active hangouts" on public."hangout_sessions"
using (((status = 'active'::text) AND (starts_at <= now()) AND (ends_at > now()) AND (EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((((f.user_one_id = (select auth.uid())) AND (f.user_two_id = hangout_sessions.owner_id)) OR ((f.user_two_id = (select auth.uid())) AND (f.user_one_id = hangout_sessions.owner_id))) AND (f.ended_at IS NULL))))))
;

alter policy "opted-in upfors are discovery eligible" on public."hangout_sessions"
using (((discovery_scope = 'nearby'::text) AND (status = 'active'::text) AND (starts_at <= now()) AND (ends_at > now()) AND ((select auth.uid()) IS NOT NULL) AND (owner_id <> (select auth.uid()))))
;

alter policy "hidden content owner access" on public."hidden_content"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "invite links creator access" on public."invite_links"
using (((select auth.uid()) = creator_id))
with check (((select auth.uid()) = creator_id))
;

alter policy "life_timeline_resets_delete_own" on public."life_timeline_resets"
using (((select auth.uid()) = user_id))
;

alter policy "life_timeline_resets_insert_own" on public."life_timeline_resets"
with check (((select auth.uid()) = user_id))
;

alter policy "life_timeline_resets_select_own" on public."life_timeline_resets"
using (((select auth.uid()) = user_id))
;

alter policy "life_timeline_resets_update_own" on public."life_timeline_resets"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "linkr actions deleted by actor" on public."linkr_actions"
using ((actor_id = (select auth.uid())))
;

alter policy "linkr actions readable by actor" on public."linkr_actions"
using ((actor_id = (select auth.uid())))
;

alter policy "linkr actions updated by actor" on public."linkr_actions"
using ((actor_id = (select auth.uid())))
with check ((actor_id = (select auth.uid())))
;

alter policy "linkr actions written by actor" on public."linkr_actions"
with check ((actor_id = (select auth.uid())))
;

alter policy "linkr connections readable by participants" on public."linkr_connections"
using (((user_low = (select auth.uid())) OR (user_high = (select auth.uid()))))
;

alter policy "linkr connections updated by participants" on public."linkr_connections"
using (((user_low = (select auth.uid())) OR (user_high = (select auth.uid()))))
with check (((user_low = (select auth.uid())) OR (user_high = (select auth.uid()))))
;

alter policy "linkr interests owned by user" on public."linkr_interests"
using ((user_id = (select auth.uid())))
with check ((user_id = (select auth.uid())))
;

alter policy "linkr profile owned by user" on public."linkr_profiles"
using ((user_id = (select auth.uid())))
with check ((user_id = (select auth.uid())))
;

alter policy "media assets owner read" on public."media_assets"
using (((select auth.uid()) = owner_id))
;

alter policy "media variants owner access" on public."media_variants"
using ((EXISTS ( SELECT 1
   FROM media_assets a
  WHERE ((a.id = media_variants.media_asset_id) AND (a.owner_id = (select auth.uid()))))))
;

alter policy "ping responses visible to participants" on public."meeting_ping_responses"
using ((EXISTS ( SELECT 1
   FROM meeting_pings p
  WHERE ((p.id = meeting_ping_responses.ping_id) AND (((select auth.uid()) = p.sender_id) OR ((select auth.uid()) = p.recipient_id))))))
;

alter policy "pings visible to participants" on public."meeting_pings"
using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = recipient_id)))
;

alter policy "meetup requests sender creates" on public."meetup_requests"
with check (((select auth.uid()) = sender_id))
;

alter policy "meetup requests visible to participants" on public."meetup_requests"
using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id)))
;

alter policy "message hides owner access" on public."message_hides"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "mentions visible with their message" on public."message_mentions"
using ((EXISTS ( SELECT 1
   FROM (messages msg
     JOIN conversation_members m ON ((m.conversation_id = msg.conversation_id)))
  WHERE ((msg.id = message_mentions.message_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text) AND (msg.created_at >= m.history_visible_from)))))
;

alter policy "message reactions owned by reactor" on public."message_reactions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "message reactions visible to members" on public."message_reactions"
using ((EXISTS ( SELECT 1
   FROM (messages msg
     JOIN conversation_members m ON ((m.conversation_id = msg.conversation_id)))
  WHERE ((msg.id = message_reactions.message_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text)))))
;

alter policy "messages visible to members" on public."messages"
using ((EXISTS ( SELECT 1
   FROM conversation_members m
  WHERE ((m.conversation_id = messages.conversation_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'joined'::text) AND (messages.created_at >= m.history_visible_from)))))
;

alter policy "moment targets author access" on public."moment_audience_targets"
using ((EXISTS ( SELECT 1
   FROM moments m
  WHERE ((m.id = moment_audience_targets.moment_id) AND (m.author_id = (select auth.uid()))))))
;

alter policy "moment reactions owned by reactor" on public."moment_reactions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "moment reactions visible to author and reactor" on public."moment_reactions"
using ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM moments m
  WHERE ((m.id = moment_reactions.moment_id) AND (m.author_id = (select auth.uid())))))))
;

alter policy "moment views owned by viewer" on public."moment_views"
using (((select auth.uid()) = viewer_id))
with check (((select auth.uid()) = viewer_id))
;

alter policy "members read active public moments" on public."moments"
using (((audience_type = 'public'::text) AND (status = 'active'::text) AND (expires_at > now()) AND (EXISTS ( SELECT 1
   FROM feature_flags f
  WHERE ((f.key = 'open_moments'::text) AND (f.status = 'on'::text)))) AND (NOT (EXISTS ( SELECT 1
   FROM blocked_users b
  WHERE (((b.blocker_id = (select auth.uid())) AND (b.blocked_id = moments.author_id)) OR ((b.blocker_id = moments.author_id) AND (b.blocked_id = (select auth.uid())))))))))
;

alter policy "moments author delete" on public."moments"
using (((select auth.uid()) = author_id))
;

alter policy "moments author insert" on public."moments"
with check ((((select auth.uid()) = author_id) AND ((audience_type <> 'public'::text) OR can_publish_open_moments((select auth.uid())))))
;

alter policy "moments author read" on public."moments"
using (((select auth.uid()) = author_id))
;

alter policy "moments author update" on public."moments"
using (((select auth.uid()) = author_id))
with check ((((select auth.uid()) = author_id) AND ((audience_type <> 'public'::text) OR can_publish_open_moments((select auth.uid())))))
;

alter policy "muddies read active moments" on public."moments"
using (((status = 'active'::text) AND (expires_at > now()) AND (EXISTS ( SELECT 1
   FROM friendships f
  WHERE (((f.user_one_id = (select auth.uid())) AND (f.user_two_id = moments.author_id)) OR ((f.user_two_id = (select auth.uid())) AND (f.user_one_id = moments.author_id))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocked_users b
  WHERE (((b.blocker_id = (select auth.uid())) AND (b.blocked_id = moments.author_id)) OR ((b.blocker_id = moments.author_id) AND (b.blocked_id = (select auth.uid())))))))))
;

alter policy "drops creator full access" on public."muddy_drops"
using (((select auth.uid()) = creator_id))
with check (((select auth.uid()) = creator_id))
;

alter policy "notification budget owner read" on public."notification_budget_usage"
using (((select auth.uid()) = user_id))
;

alter policy "notifications owner reads" on public."notifications"
using (((select auth.uid()) = user_id))
;

alter policy "onboarding progress owner access" on public."onboarding_progress"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "participants visible to plan members" on public."plan_participants"
using ((((select auth.uid()) = user_id) OR is_plan_creator(plan_id)))
;

alter policy "poll options visible to plan members" on public."plan_poll_options"
using ((EXISTS ( SELECT 1
   FROM (plan_polls pk
     JOIN plans pl ON ((pl.id = pk.plan_id)))
  WHERE ((pk.id = plan_poll_options.poll_id) AND ((pl.creator_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM plan_participants pp
          WHERE ((pp.plan_id = pl.id) AND (pp.user_id = (select auth.uid())) AND (pp.rsvp_status <> 'removed'::text)))))))))
;

alter policy "poll votes owned by voter" on public."plan_poll_votes"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "poll votes readable by plan members" on public."plan_poll_votes"
using ((EXISTS ( SELECT 1
   FROM (plan_polls pk
     JOIN plans pl ON ((pl.id = pk.plan_id)))
  WHERE ((pk.id = plan_poll_votes.poll_id) AND ((pl.creator_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM plan_participants pp
          WHERE ((pp.plan_id = pl.id) AND (pp.user_id = (select auth.uid())) AND (pp.rsvp_status <> 'removed'::text)))))))))
;

alter policy "polls visible to plan members" on public."plan_polls"
using ((EXISTS ( SELECT 1
   FROM plans pl
  WHERE ((pl.id = plan_polls.plan_id) AND ((pl.creator_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM plan_participants pp
          WHERE ((pp.plan_id = pl.id) AND (pp.user_id = (select auth.uid())) AND (pp.rsvp_status <> 'removed'::text)))))))))
;

alter policy "plans editable by creator" on public."plans"
using (((select auth.uid()) = creator_id))
with check (((select auth.uid()) = creator_id))
;

alter policy "plans visible to participants" on public."plans"
using ((((select auth.uid()) = creator_id) OR (EXISTS ( SELECT 1
   FROM plan_participants p
  WHERE ((p.plan_id = plans.id) AND (p.user_id = (select auth.uid())) AND (p.rsvp_status <> 'removed'::text))))))
;

alter policy "privacy requests insert by owner" on public."privacy_requests"
with check (((select auth.uid()) = user_id))
;

alter policy "privacy requests owner access" on public."privacy_requests"
using (((select auth.uid()) = user_id))
;

alter policy "privacy setup versions owner access" on public."privacy_setup_versions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "privacy zones owner only" on public."privacy_zones"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "profile birth details owner select" on public."profile_birth_details"
using (((select auth.uid()) = user_id))
;

alter policy "profile field privacy owner access" on public."profile_field_privacy"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "own photos manageable" on public."profile_photos"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "public photos readable" on public."profile_photos"
using (((visibility = 'everyone'::text) AND ((select auth.uid()) IS NOT NULL)))
;

alter policy "profiles owner full access" on public."profiles"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "promotion redemptions owner read" on public."promotion_redemptions"
using (((select auth.uid()) = user_id))
;

alter policy "proximity owner reads derived signals" on public."proximity_events"
using (((select auth.uid()) = user_id))
;

alter policy "push subscriptions owner access" on public."push_subscriptions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "qr sessions owner access" on public."qr_sessions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "rate limits owner readable" on public."rate_limits"
using (((select auth.uid()) = user_id))
;

alter policy "recap preferences owner access" on public."recap_preferences"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "relationship_notes_delete_own" on public."relationship_notes"
using (((select auth.uid()) = author_id))
;

alter policy "relationship_notes_insert_own" on public."relationship_notes"
with check ((((select auth.uid()) = author_id) AND (author_id <> subject_id)))
;

alter policy "relationship_notes_select_own" on public."relationship_notes"
using (((select auth.uid()) = author_id))
;

alter policy "relationship_notes_update_own" on public."relationship_notes"
using (((select auth.uid()) = author_id))
with check (((select auth.uid()) = author_id))
;

alter policy "reports reporter can read own" on public."reports"
using (((select auth.uid()) = reporter_id))
;

alter policy "reports reporter creates" on public."reports"
with check ((((select auth.uid()) = reporter_id) AND (status = 'open'::report_status)))
;

alter policy "safe arrival blocks owner access" on public."safe_arrival_blocks"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "safe arrival traveller read" on public."safe_arrival_sessions"
using (((select auth.uid()) = traveller_id))
;

alter policy "saved folders owner access" on public."saved_message_folders"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "saved messages owner delete" on public."saved_messages"
using (((select auth.uid()) = user_id))
;

alter policy "saved messages owner insert" on public."saved_messages"
with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = saved_messages.message_id) AND is_conversation_member(m.conversation_id))))))
;

alter policy "saved messages owner read" on public."saved_messages"
using ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = saved_messages.message_id) AND is_conversation_member(m.conversation_id))))))
;

alter policy "saved messages owner update" on public."saved_messages"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "users acknowledge own smart cards" on public."smart_card_acknowledgements"
with check (((select auth.uid()) = user_id))
;

alter policy "users read own smart card acknowledgements" on public."smart_card_acknowledgements"
using (((select auth.uid()) = user_id))
;

alter policy "socialize owner full access" on public."socialize_sessions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "status targets owner access" on public."status_visibility_targets"
using ((EXISTS ( SELECT 1
   FROM user_statuses s
  WHERE ((s.id = status_visibility_targets.status_id) AND (s.user_id = (select auth.uid()))))))
;

alter policy "streak events visible to the pair" on public."streak_qualifying_events"
using ((EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((f.id = streak_qualifying_events.friendship_id) AND (((select auth.uid()) = f.user_one_id) OR ((select auth.uid()) = f.user_two_id))))))
;

alter policy "subscription changes owner read" on public."subscription_changes"
using (((select auth.uid()) = user_id))
;

alter policy "subscriptions owner can read" on public."subscriptions"
using (((select auth.uid()) = user_id))
;

alter policy "support request owner insert" on public."support_requests"
with check (((select auth.uid()) = user_id))
;

alter policy "support request owner read" on public."support_requests"
using (((select auth.uid()) = user_id))
;

alter policy "support messages insert by ticket owner" on public."support_ticket_messages"
with check (((sender_type = 'user'::text) AND ((select auth.uid()) = sender_id) AND (EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (t.user_id = (select auth.uid())))))))
;

alter policy "support messages visible to ticket owner" on public."support_ticket_messages"
using ((EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (t.user_id = (select auth.uid()))))))
;

alter policy "support tickets owner creates" on public."support_tickets"
with check ((((select auth.uid()) = user_id) AND (status = 'new'::text) AND (priority = 'normal'::text) AND (assigned_to IS NULL) AND (resolved_at IS NULL)))
;

alter policy "support tickets owner reads" on public."support_tickets"
using (((select auth.uid()) = user_id))
;

alter policy "plans visible to participants" on public."temporary_plans"
using ((((select auth.uid()) = creator_id) OR ((select auth.uid()) = participant_id)))
;

alter policy "own trusted application insertable" on public."trusted_member_applications"
with check ((((select auth.uid()) = user_id) AND (status = 'pending'::text)))
;

alter policy "own trusted application readable" on public."trusted_member_applications"
using (((select auth.uid()) = user_id))
;

alter policy "tune ins owned by viewer" on public."tune_ins"
using (((select auth.uid()) = viewer_id))
with check (((select auth.uid()) = viewer_id))
;

alter policy "user achievements owner access" on public."user_achievements"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "interests owner access" on public."user_interests"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "interests readable by muddies" on public."user_interests"
using ((EXISTS ( SELECT 1
   FROM friendships f
  WHERE (((f.user_one_id = (select auth.uid())) AND (f.user_two_id = user_interests.user_id)) OR ((f.user_two_id = (select auth.uid())) AND (f.user_one_id = user_interests.user_id))))))
;

alter policy "location owner only" on public."user_locations"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "preferences owner access" on public."user_preferences"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "muddies read unexpired statuses" on public."user_statuses"
using (((expires_at > now()) AND (EXISTS ( SELECT 1
   FROM friendships f
  WHERE (((f.user_one_id = (select auth.uid())) AND (f.user_two_id = user_statuses.user_id)) OR ((f.user_two_id = (select auth.uid())) AND (f.user_one_id = user_statuses.user_id)))))))
;

alter policy "statuses owner full access" on public."user_statuses"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "tour progress owner insert" on public."user_tour_progress"
with check (((select auth.uid()) = user_id))
;

alter policy "tour progress owner read" on public."user_tour_progress"
using (((select auth.uid()) = user_id))
;

alter policy "tour progress owner update" on public."user_tour_progress"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "own wallpaper preference readable" on public."user_wallpaper_preferences"
using (((select auth.uid()) = user_id))
;

alter policy "visibility sessions owner only" on public."visibility_sessions"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "visibility targets owner only" on public."visibility_targets"
using ((EXISTS ( SELECT 1
   FROM visibility_sessions s
  WHERE ((s.id = visibility_targets.session_id) AND (s.user_id = (select auth.uid()))))))
;

alter policy "wave mutes owner access" on public."wave_mutes"
using (((select auth.uid()) = user_id))
with check (((select auth.uid()) = user_id))
;

alter policy "waves recipient can mark seen" on public."waves"
using (((select auth.uid()) = recipient_id))
with check (((select auth.uid()) = recipient_id))
;

alter policy "waves visible to participants" on public."waves"
using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = recipient_id)))
;

create index if not exists user_locations_last_updated_idx
  on public.user_locations(last_updated);

create index if not exists proximity_events_friend_id_idx
  on public.proximity_events(friend_id);

create index if not exists messages_media_id_idx
  on public.messages(media_id)
  where media_id is not null;

create index if not exists moments_media_id_idx
  on public.moments(media_id)
  where media_id is not null;

create index if not exists jobs_periodic_completed_retention_idx
  on public.jobs(completed_at)
  where status='completed'
    and idempotency_key like 'periodic:%';

CREATE OR REPLACE FUNCTION private.prune_operational_history()
 RETURNS TABLE(periodic_jobs_deleted bigint, rate_limit_rows_deleted bigint, cron_runs_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_jobs bigint := 0;
  v_rate_limits bigint := 0;
  v_cron bigint := 0;
begin
  delete from public.jobs
  where status = 'completed'
    and idempotency_key like 'periodic:%'
    and completed_at is not null
    and completed_at < now() - interval '30 days';
  get diagnostics v_jobs = row_count;

  delete from public.rate_limits
  where window_end < now() - interval '30 days';
  get diagnostics v_rate_limits = row_count;

  delete from cron.job_run_details
  where end_time is not null
    and end_time < now() - interval '30 days';
  get diagnostics v_cron = row_count;

  return query select v_jobs, v_rate_limits, v_cron;
end;
$function$;

revoke all on function private.prune_operational_history() from public, anon, authenticated;
grant execute on function private.prune_operational_history() to service_role;

select cron.schedule(
  'privacy-location-expiry-5min',
  '*/5 * * * *',
  $$select public.cleanup_expired_private_location(), public.cleanup_expired_proximity_events();$$
);

select cron.schedule(
  'operational-history-prune-daily',
  '17 3 * * *',
  $$select * from private.prune_operational_history();$$
);

-- Clear the known backlog immediately; both functions are idempotent and
-- their ongoing cron schedules keep future batches small.
select public.cleanup_expired_private_location(), public.cleanup_expired_proximity_events();
select * from private.prune_operational_history();
