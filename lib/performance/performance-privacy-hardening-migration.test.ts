import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261002092314_performance_privacy_hardening.sql",
  "utf8"
);

describe("performance and privacy hardening migration", () => {
  it("keeps the Event Updates admin check scoped to the same event", () => {
    expect(migration).toContain("a.event_id = event_updates.event_id");
    expect(migration).not.toContain("a.event_id = a.event_id");
  });

  it("ships the targeted indexes and retention schedules", () => {
    for (const index of [
      "user_locations_last_updated_idx",
      "proximity_events_friend_id_idx",
      "messages_media_id_idx",
      "moments_media_id_idx",
      "jobs_periodic_completed_retention_idx"
    ]) {
      expect(migration).toContain(index);
    }

    expect(migration).toContain("private.prune_operational_history()");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path TO ''");
    expect(migration).toContain("privacy-location-expiry-5min");
    expect(migration).toContain("operational-history-prune-daily");
  });

  it("preserves newer chat-poll parent liveness protection", () => {
    expect(migration).toContain("chat_poll_parent_is_live");
  });
});
