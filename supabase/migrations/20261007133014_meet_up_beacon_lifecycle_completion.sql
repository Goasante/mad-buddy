-- Staging completion marker.
-- Staging received the canonical idempotent Meet Up Beacon lifecycle SQL under
-- this migration version to reconcile an earlier partial apply. Production
-- receives the complete schema from 20261007132256_meet_up_beacon_lifecycle.sql.
select 1;
