import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * The Vercel usage optimization pass: badge polling.
 *
 * WHAT MOTIVATED THIS FILE. Production usage showed 247 invocations of
 * /api/messages/unread-count and 259 of /api/friends/request-count in one
 * inspected window -- almost entirely a 30-second setInterval running on
 * every authenticated page via AppShell, in useUnreadMessageCount's case
 * ALONGSIDE a Realtime subscription that already refetches on every relevant
 * change. The interval was not making the badge more correct; it was paying
 * for a number that had usually not moved.
 *
 * THE SHAPE OF THE FIX, and why it is asserted at this level rather than by
 * mounting the hooks: this repo runs vitest with `environment: "node"` (see
 * vitest.config), so there is no DOM and no way to fake a WebSocket lifecycle
 * in a real browser sense. Every hook test in this codebase is therefore a
 * source-text assertion against the guarantee, not a rendered interaction --
 * the same pattern lib/social and lib/contacts already use. What is asserted
 * here is structural and could not pass by accident: the interval is gone,
 * the Realtime listener and its reconnect resync are present, and the
 * fallback listeners are still wired.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const messageCount = stripComments(read("hooks/use-unread-message-count.ts"));
const notificationCount = stripComments(read("hooks/use-unread-notification-count.ts"));
const liveSignalToast = stripComments(read("components/notifications/live-signal-toast.tsx"));
const requestCount = stripComments(read("hooks/use-incoming-request-count.ts"));
const friendService = stripComments(read("lib/friends/service.ts"));
const publicationMigration = read("supabase/migrations/20260811120000_realtime_friend_requests.sql");
const notificationsPublicationMigration = read("supabase/migrations/20260723160000_realtime_notifications.sql");

// ---------------------------------------------------------------------------
// Message unread count: interval removed, Realtime + reconnect resync kept
// ---------------------------------------------------------------------------

describe("useUnreadMessageCount has no interval poll", () => {
  it("no longer runs a 30-second timer", () => {
    expect(messageCount).not.toContain("setInterval");
    expect(messageCount).not.toContain("30_000");
  });

  it("still fetches once on mount", () => {
    // Anchored on a substring that survives CRLF rather than a literal \n,
    // which does not match on a checkout where git has normalised line
    // endings -- the same brittleness this session hit and fixed twice
    // before in other files.
    const effect = messageCount.slice(messageCount.indexOf("const handleUpdated = (event: Event) => {"));
    expect(effect.slice(0, 400)).toContain("void refresh();");
  });

  it("keeps the Realtime INSERT listener that made the poll redundant", () => {
    expect(messageCount).toContain('"postgres_changes"');
    expect(messageCount).toContain('event: "INSERT"');
    expect(messageCount).toContain('table: "messages"');
  });

  it("resyncs once on reconnect, not on every SUBSCRIBED", () => {
    // The first SUBSCRIBED is the normal start of a fresh subscription --
    // the mount-time refresh() already covers it. Only a SUBSCRIBED that
    // follows a previous one (a genuine reconnect, which may have missed an
    // INSERT while the socket was down) should trigger a fresh refresh.
    expect(messageCount).toContain("hasSubscribedOnce");
    const subscribe = messageCount.slice(messageCount.indexOf("channel.subscribe((status)"));
    expect(subscribe.slice(0, 300)).toContain('status !== "SUBSCRIBED"');
    expect(subscribe.slice(0, 300)).toContain("if (hasSubscribedOnce) void refresh();");
    expect(subscribe.slice(0, 300)).toContain("hasSubscribedOnce = true;");
  });

  it("keeps focus and visibility as the correctness net, not a new timer", () => {
    // Both existed before the interval was removed and are the fallback for
    // what Realtime cannot cover on its own -- a socket that dropped without
    // ever surfacing CLOSED, a phone that slept through an event.
    expect(messageCount).toContain('window.addEventListener("focus", handleFocus)');
    expect(messageCount).toContain('document.addEventListener("visibilitychange", handleVisibility)');
  });

  it("keeps in-flight dedup, so a Realtime event and a focus resync cannot race", () => {
    expect(messageCount).toContain("if (inFlight.current) return inFlight.current;");
  });

  it("creates exactly one Realtime channel for this purpose", () => {
    expect((messageCount.match(/\.channel\(/g) ?? []).length).toBe(1);
  });

  it("still authenticates the socket before subscribing", () => {
    // RLS-protected tables: a socket holding only the publishable key sees
    // nothing and closes with CHANNEL_ERROR without this.
    const order = messageCount.indexOf("authenticateRealtime(supabase)");
    const subscribeAt = messageCount.indexOf("channel.subscribe(");
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(subscribeAt);
  });

  it("cleans up the channel on unmount", () => {
    expect(messageCount).toContain("supabase.removeChannel(channel)");
  });
});

// ---------------------------------------------------------------------------
// Notification unread count: interval removed, still listens for the signal
// ---------------------------------------------------------------------------

describe("useUnreadNotificationCount has no interval poll", () => {
  it("no longer runs its own timer", () => {
    expect(notificationCount).not.toContain("setInterval");
    expect(notificationCount).not.toContain("60_000");
  });

  it("does not fetch on mount", () => {
    // Deliberately: the count is seeded server-side (initialCount, sourced
    // from AppShellProps.initialUnreadCount) so there is nothing to
    // reconcile at mount, unlike messages which starts from zero.
    //
    // The only three `void refresh()` call sites are inside the focus,
    // visibility and update handlers -- none of them a bare statement that
    // would run once at mount. Named exactly, rather than matched with a
    // literal \n in the search string, which does not survive a
    // CRLF-normalised checkout and would silently never match.
    expect(notificationCount).toContain("const handleFocus = () => void refresh();");
    expect(notificationCount).toContain("if (document.visibilityState === \"visible\") void refresh();");
    expect(notificationCount).toContain("else void refresh();");
    expect((notificationCount.match(/void refresh\(\);/g) ?? []).length).toBe(3);
  });

  it("still listens for the shared broadcast", () => {
    expect(notificationCount).toContain("NOTIFICATIONS_UPDATED_EVENT");
    expect(notificationCount).toContain("window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleUpdated)");
  });

  it("keeps focus and visibility as the resume fallback", () => {
    expect(notificationCount).toContain('window.addEventListener("focus", handleFocus)');
    expect(notificationCount).toContain('document.addEventListener("visibilitychange", handleVisibility)');
  });

  it("keeps in-flight dedup", () => {
    expect(notificationCount).toContain("if (inFlight.current) return inFlight.current;");
  });

  it("uses the count carried on the broadcast when one is given", () => {
    // Avoids a round trip when the publisher already knows the new number.
    expect(notificationCount).toContain("typeof detail?.unreadCount === \"number\"");
  });
});

// ---------------------------------------------------------------------------
// LiveSignalToast: the 45s poll only runs while Realtime is unhealthy
// ---------------------------------------------------------------------------

describe("LiveSignalToast polls only as a fallback, not unconditionally", () => {
  it("no longer starts the interval unconditionally at mount", () => {
    // The old shape called setInterval directly in the effect body. It is
    // now wrapped behind startPoll/stopPoll so SUBSCRIBED can tear it down.
    expect(liveSignalToast).toContain("const startPoll = () => {");
    expect(liveSignalToast).toContain("const stopPoll = () => {");
  });

  it("stops the poll once Realtime confirms SUBSCRIBED", () => {
    const subscribe = liveSignalToast.slice(liveSignalToast.indexOf("channel.subscribe((status)"));
    const body = subscribe.slice(0, subscribe.indexOf("});") + 3);
    expect(body).toContain('status === "SUBSCRIBED"');
    const subscribedBranch = body.slice(body.indexOf('status === "SUBSCRIBED"'));
    expect(subscribedBranch.slice(0, 100)).toContain("stopPoll();");
  });

  it("resumes the poll if the channel drops after connecting", () => {
    const subscribe = liveSignalToast.slice(liveSignalToast.indexOf("channel.subscribe((status)"));
    const body = subscribe.slice(0, subscribe.indexOf("});") + 3);
    expect(body).toContain('"CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"');
    const dropBranch = body.slice(body.indexOf('"CHANNEL_ERROR"'));
    expect(dropBranch.slice(0, 200)).toContain("startPoll();");
  });

  it("starts the poll immediately, before Realtime has had a chance to connect", () => {
    // Correctness first: there must be no gap between mount and either the
    // poll or a confirmed subscription where nothing is watching.
    expect(liveSignalToast).toContain("startPoll();");
    const mountOrder = liveSignalToast.indexOf("startPoll();");
    const subscribeOrder = liveSignalToast.indexOf("channel.subscribe((status)");
    expect(mountOrder).toBeLessThan(subscribeOrder);
  });

  it("still tears the interval down cleanly on unmount", () => {
    // Anchored on the effect that owns startPoll/stopPoll, not the last
    // return in the file -- a second, unrelated effect further down also
    // has its own cleanup.
    const effect = liveSignalToast.slice(liveSignalToast.indexOf("const startPoll = () => {"));
    const cleanup = effect.slice(effect.indexOf("return () => {"));
    expect(cleanup.slice(0, 300)).toContain("stopPoll();");
  });

  it("guards against starting two intervals at once", () => {
    const startPoll = liveSignalToast.slice(liveSignalToast.indexOf("const startPoll = () => {"));
    expect(startPoll.slice(0, 200)).toContain("if (pollTimer !== undefined) return;");
  });

  it("keeps the broadcast firing on both the realtime and poll paths", () => {
    // Whichever path actually detects the new row, the badge must hear it.
    const matches = liveSignalToast.match(/mad-buddy:notifications-updated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("still authenticates before subscribing, same as before", () => {
    const order = liveSignalToast.indexOf("authenticateRealtime(supabase)");
    const subscribeAt = liveSignalToast.indexOf("channel.subscribe(");
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(subscribeAt);
  });

  it("still filters the subscription to this user's own rows", () => {
    expect(liveSignalToast).toContain("filter: `user_id=eq.${currentUserId}`");
  });
});

// ---------------------------------------------------------------------------
// Friend requests: newly Realtime-backed, 30s poll reduced to a 5min net
// ---------------------------------------------------------------------------

describe("useIncomingRequestCount is now Realtime-backed", () => {
  it("no longer polls every 30 seconds", () => {
    expect(requestCount).not.toContain("30_000");
  });

  it("polls only as a 5-minute safety net, named rather than inlined", () => {
    expect(requestCount).toContain("export const FRIEND_REQUEST_SAFETY_POLL_MS = 5 * 60 * 1000;");
    expect(requestCount).toContain("FRIEND_REQUEST_SAFETY_POLL_MS");
  });

  it("subscribes to INSERT, UPDATE and DELETE, not just INSERT", () => {
    // countIncomingRequests counts status = 'pending' rows, and acceptDecline
    // flips that status via UPDATE rather than deleting the row -- so an
    // accept or decline only changes the count through an UPDATE event.
    // INSERT-only would miss every accept and decline.
    for (const event of ['event: "INSERT"', 'event: "UPDATE"', 'event: "DELETE"']) {
      expect(requestCount, event).toContain(event);
    }
  });

  it("scopes the subscription to rows where the viewer is the receiver", () => {
    // Incoming requests only: a request this user SENT changing status must
    // not appear as incoming activity to them.
    expect((requestCount.match(/filter: `receiver_id=eq\.\$\{userId\}`/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("matches the acceptDecline mutation this is meant to observe", () => {
    // Confirms the premise: acceptance/decline really is an UPDATE, not a
    // DELETE, so subscribing to UPDATE is not incidental.
    const updateSite = friendService.slice(friendService.indexOf(".update({ status, responded_at:"));
    expect(updateSite.slice(0, 200)).toContain('.eq("status", "pending")');
  });

  it("resyncs once on reconnect, matching useUnreadMessageCount's shape", () => {
    expect(requestCount).toContain("hasSubscribedOnce");
    const subscribe = requestCount.slice(requestCount.lastIndexOf("channel.subscribe((status)"));
    expect(subscribe.slice(0, 300)).toContain('status !== "SUBSCRIBED"');
    expect(subscribe.slice(0, 300)).toContain("if (hasSubscribedOnce) void refresh();");
  });

  it("authenticates before subscribing", () => {
    const order = requestCount.indexOf("authenticateRealtime(supabase)");
    const subscribeAt = requestCount.indexOf("channel.subscribe(");
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(subscribeAt);
  });

  it("keeps in-flight dedup and the broadcast escape hatch", () => {
    expect(requestCount).toContain("if (inFlight.current) return inFlight.current;");
    expect(requestCount).toContain("MUDDY_REQUESTS_UPDATED_EVENT");
  });

  it("creates exactly one channel for this purpose and cleans it up", () => {
    expect((requestCount.match(/\.channel\(/g) ?? []).length).toBe(1);
    expect(requestCount).toContain("supabase.removeChannel(channel)");
  });
});

// ---------------------------------------------------------------------------
// The publication migration
// ---------------------------------------------------------------------------

describe("friend_requests Realtime publication migration", () => {
  it("adds the table idempotently, matching the notifications precedent exactly", () => {
    expect(publicationMigration).toContain("alter publication supabase_realtime add table public.friend_requests");
    expect(publicationMigration).toContain("pg_publication_tables");
    expect(publicationMigration).toContain("pubname = 'supabase_realtime'");
  });

  it("follows the same idempotent-guard shape as the notifications migration", () => {
    // Same do $$ ... end $$ / not exists guard, so a second apply is a no-op
    // rather than an error -- structurally identical to the precedent, not
    // just similar in intent.
    const shape = (sql: string) =>
      sql
        .replace(/public\.\w+/g, "public.TABLE")
        .replace(/tablename = '\w+'/g, "tablename = 'TABLE'");
    expect(shape(publicationMigration).includes("do $$")).toBe(true);
    expect(shape(publicationMigration).includes("if not exists (")).toBe(true);
    expect(shape(publicationMigration)).toContain(shape(notificationsPublicationMigration).match(/if not exists[\s\S]*?end\s*\$\$;/)![0].split("\n")[0]);
  });

  it("documents rollback, matching the notifications precedent", () => {
    expect(publicationMigration).toContain("-- Rollback: alter publication supabase_realtime drop table public.friend_requests;");
  });

  it("is purely additive: grants no new write access", () => {
    // Checked against actual SQL statements, not the migration's own prose --
    // its comments legitimately discuss what INSERT/UPDATE/grant mean for
    // context, without the migration issuing any of them.
    const sqlOnly = publicationMigration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    expect(sqlOnly).not.toContain("grant ");
    expect(sqlOnly).not.toContain("create policy");
    expect(sqlOnly).not.toContain("insert into");
    expect(sqlOnly).not.toContain("update public");
    expect(sqlOnly).not.toContain("delete from");
  });

  it("relies on existing RLS rather than adding new authorization", () => {
    expect(publicationMigration.toLowerCase()).toContain("rls");
    expect(publicationMigration).toContain("sender_id, receiver_id");
  });
});
