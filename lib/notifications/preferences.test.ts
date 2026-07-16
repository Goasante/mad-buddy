import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  decideNotification,
  isWithinQuietHours,
  normalizePreferences,
  type NotificationEvent,
  type NotificationPreferences
} from "@/lib/notifications/preferences";

function prefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides };
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    category: "waves",
    priority: "normal",
    fromCloseFriend: false,
    recipientLocalMinute: 12 * 60, // noon, outside quiet hours
    ...overrides
  };
}

describe("normalizePreferences", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(normalizePreferences({ categories: { waves: "nonsense" } }).categories.waves).toBe("all");
  });

  it("keeps valid overrides", () => {
    const merged = normalizePreferences({ categories: { waves: "off" }, quietHoursEnabled: false });
    expect(merged.categories.waves).toBe("off");
    expect(merged.quietHoursEnabled).toBe(false);
  });
});

describe("isWithinQuietHours (spec §20, §26)", () => {
  it("handles a window crossing midnight (23:00→07:00)", () => {
    const p = prefs({ quietHoursStartMinute: 23 * 60, quietHoursEndMinute: 7 * 60 });
    expect(isWithinQuietHours(p, 23 * 60 + 30)).toBe(true); // 11:30pm
    expect(isWithinQuietHours(p, 3 * 60)).toBe(true); // 3am
    expect(isWithinQuietHours(p, 12 * 60)).toBe(false); // noon
  });

  it("is inactive when disabled", () => {
    expect(isWithinQuietHours(prefs({ quietHoursEnabled: false }), 3 * 60)).toBe(false);
  });
});

describe("decideNotification (spec §22)", () => {
  it("critical always breaks through, even in quiet hours", () => {
    const decision = decideNotification(prefs(), event({ priority: "critical", recipientLocalMinute: 3 * 60 }));
    expect(decision).toEqual({ inApp: true, push: true, reason: "deliver" });
  });

  it("off suppresses everything", () => {
    const p = prefs({ categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, waves: "off" } });
    expect(decideNotification(p, event())).toMatchObject({ inApp: false, push: false, reason: "off" });
  });

  it("close-friends-only drops non-close-friend senders", () => {
    const p = prefs({ categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, waves: "close_friends" } });
    expect(decideNotification(p, event({ fromCloseFriend: false })).reason).toBe("not_close_friend");
    expect(decideNotification(p, event({ fromCloseFriend: true })).push).toBe(true);
  });

  it("in-app-only never pushes", () => {
    const p = prefs({ categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, waves: "in_app_only" } });
    expect(decideNotification(p, event())).toMatchObject({ inApp: true, push: false, reason: "in_app_only" });
  });

  it("quiet hours suppress push but keep in-app for normal events", () => {
    const decision = decideNotification(prefs(), event({ recipientLocalMinute: 3 * 60 }));
    expect(decision).toMatchObject({ inApp: true, push: false, reason: "quiet_hours" });
  });

  it("delivers push outside quiet hours", () => {
    expect(decideNotification(prefs(), event()).push).toBe(true);
  });
});
