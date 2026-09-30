import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStoryEngagement, recordStoryView, setStoryLike } from "@/lib/stories/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/content/service", () => ({ queueMediaDeletion: vi.fn(), signMediaForAsset: vi.fn() }));

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, failedTables: string[] = []) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      calls.push(table);
      const filters: ((row: Row) => boolean)[] = [];
      let single = false, head = false, start = 0, end = Infinity;
      let operation = "select";
      let payload: Row = {};
      const query = {
        select(_fields: string, options?: { head?: boolean }) { head = Boolean(options?.head); return query; },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
        neq(key: string, value: unknown) { filters.push((row) => row[key] !== value); return query; },
        is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
        gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return query; },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
        or(expression: string) { filters.push((row) => expression.split(",").some((part) => { const [key, , value] = part.split("."); return row[key] === value; })); return query; },
        order() { return query; },
        range(first: number, last: number) { start = first; end = last + 1; return query; },
        maybeSingle() { single = true; return query; },
        upsert(record: Row) { operation = "upsert"; payload = record; return query; },
        delete() { operation = "delete"; return query; },
        then(resolve: (result: { data: Row[] | Row | null; count: number; error: unknown }) => unknown) {
          const rows = tables[table] ?? [];
          const matches = rows.filter((row) => filters.every((filter) => filter(row)));
          const error = failedTables.includes(table) ? { message: "test error" } : null;
          if (!error && operation === "upsert") {
            const index = rows.findIndex((row) => row.moment_id === payload.moment_id && (row.user_id ?? row.viewer_id) === (payload.user_id ?? payload.viewer_id));
            if (index < 0) rows.push(payload); else rows[index] = { ...rows[index], ...payload };
            tables[table] = rows;
          }
          if (!error && operation === "delete") tables[table] = rows.filter((row) => !matches.includes(row));
          return Promise.resolve(resolve({ data: error || head ? null : single ? matches[0] ?? null : matches.slice(start, end), count: matches.length, error }));
        }
      };
      return query;
    }
  };
  return { admin: admin as unknown as ReturnType<typeof createSupabaseAdminClient>, calls };
}

let tables: Record<string, Row[]>;
beforeEach(() => {
  tables = {
    moments: [{ id: "story", author_id: "author", media_id: "photo", surface: "story", content_type: "photo", status: "active", audience_type: "all_muddies", expires_at: new Date(Date.now() + 3600000).toISOString() }],
    friendships: [{ user_one_id: "author", user_two_id: "viewer", ended_at: null }],
    blocked_users: [], close_friend_relationships: [], moment_audience_targets: [], hidden_content: [],
    moment_reactions: [], moment_views: [], profiles: [{ user_id: "viewer", full_name: "Muddy", avatar_url: null }]
  };
});

describe("private Story engagement", () => {
  it("never reveals viewer identities or counts to another user", async () => {
    const { admin, calls } = database(tables);
    expect(await loadStoryEngagement(admin, "viewer", "story")).toBeNull();
    expect(calls).toEqual(["moments"]);
  });
  it("counts unique views and desired-state likes without duplicates", async () => {
    const { admin } = database(tables);
    expect(await recordStoryView(admin, "viewer", "story")).toBe(true);
    expect(await recordStoryView(admin, "viewer", "story")).toBe(true);
    expect(await setStoryLike(admin, "viewer", "story", true)).toBe(true);
    expect(await setStoryLike(admin, "viewer", "story", true)).toBe(true);
    expect(await loadStoryEngagement(admin, "author", "story")).toMatchObject({ viewCount: 1, likeCount: 1, viewers: [{ id: "viewer", name: "Muddy", liked: true }], nextOffset: null });
    expect(await setStoryLike(admin, "viewer", "story", false)).toBe(true);
    expect(await loadStoryEngagement(admin, "author", "story")).toMatchObject({ viewCount: 1, likeCount: 0, viewers: [{ liked: false }] });
  });
  it.each(["stranger", "author"])("rejects likes by %s", async (viewer) => {
    expect(await setStoryLike(database(tables).admin, viewer, "story", true)).toBe(false);
    expect(tables.moment_reactions).toHaveLength(0);
  });
  it("rejects a removed audience member and a blocked Muddy", async () => {
    tables.moments[0].audience_type = "selected_muddies";
    expect(await setStoryLike(database(tables).admin, "viewer", "story", true)).toBe(false);
    tables.moments[0].audience_type = "all_muddies";
    tables.blocked_users = [{ blocker_id: "viewer", blocked_id: "author" }];
    expect(await setStoryLike(database(tables).admin, "viewer", "story", true)).toBe(false);
  });
  it("fails closed on relationship errors", async () => {
    expect(await setStoryLike(database(tables, ["friendships"]).admin, "viewer", "story", true)).toBe(false);
  });
  it("makes expired or deleted Stories unavailable", async () => {
    tables.moments[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const { admin } = database(tables);
    expect(await loadStoryEngagement(admin, "author", "story")).toBeNull();
    expect(await setStoryLike(admin, "viewer", "story", true)).toBe(false);
  });
  it("bounds the viewer page and keeps totals across pages", async () => {
    tables.moment_views = Array.from({ length: 51 }, (_, i) => ({ moment_id: "story", viewer_id: `viewer-${i}`, viewed_at: "2026-09-30T00:00:00Z" }));
    const { admin } = database(tables);
    const first = await loadStoryEngagement(admin, "author", "story");
    expect(first?.viewCount).toBe(51);
    expect(first?.viewers).toHaveLength(50);
    expect(first?.nextOffset).toBe(50);
    const last = await loadStoryEngagement(admin, "author", "story", 50);
    expect(last?.viewers).toHaveLength(1);
    expect(last?.nextOffset).toBeNull();
  });
});
