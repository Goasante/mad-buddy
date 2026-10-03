import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteAccountForUser, purgeUserData, removeUserStorage } from "./deletion";

function workflowFixture(options: { failTable?: string; authFailure?: boolean; featureFailure?: boolean } = {}) {
  const calls: Array<{ table: string; operation: string; value?: unknown; filter?: unknown[] }> = [];
  let audited = false;
  const deleteUser = vi.fn().mockResolvedValue({ error: options.authFailure ? new Error("Auth unavailable") : null });
  const admin = {
    storage: storageFixture().storage,
    auth: { admin: { deleteUser } },
    rpc: vi.fn().mockResolvedValue({ error: null }),
    from(table: string) {
      const query = (operation: string, value?: unknown) => {
        const call = { table, operation, value, filter: [] as unknown[] };
        calls.push(call);
        const result = () => {
          const error = table === options.failTable || (table === "feature_flags" && options.featureFailure)
            ? { code: "08006" } : null;
          let data: unknown = null;
          if (table === "feature_flags" && !error) data = { key: "conference" };
          if (table === "deletion_audit_logs" && operation === "select" && audited) data = { id: "audit" };
          if (table === "deletion_audit_logs" && operation === "insert" && !error) audited = true;
          return { data, error };
        };
        const chain = {
          eq: (...args: unknown[]) => { call.filter.push(args); return chain; },
          or: (...args: unknown[]) => { call.filter.push(args); return chain; },
          limit: () => chain,
          maybeSingle: async () => result(),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
        };
        return chain;
      };
      return { select: () => query("select"), update: (v: unknown) => query("update", v),
        insert: (v: unknown) => query("insert", v), upsert: (v: unknown) => query("upsert", v), delete: () => query("delete") };
    }
  };
  return { admin: admin as unknown as SupabaseClient, calls, deleteUser };
}

function storageFixture(options: { failBucket?: string } = {}) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const listed: string[] = [];
  const files = Array.from({ length: 101 }, (_, index) => ({ id: `${index}`, name: `image-${String(index).padStart(3, "0")}.jpg` }));
  const storage = {
    from(bucket: string) {
      return {
        async list(directory: string, args: { offset: number; limit: number }) {
          listed.push(`${bucket}:${directory}:${args.offset}`);
          if (bucket === options.failBucket) return { data: null, error: new Error("storage unavailable") };
          const entries = bucket === "media" && directory === "person"
            ? [{ id: null, name: "chat" }]
            : bucket === "media" && directory === "person/chat" ? files : [];
          return { data: entries.slice(args.offset, args.offset + args.limit), error: null };
        },
        async remove(paths: string[]) {
          removed.push({ bucket, paths });
          return { error: null };
        }
      };
    }
  };
  return { storage, listed, removed };
}

describe("account deletion storage cleanup", () => {
  it("removes nested files across pages and checks every upload bucket", async () => {
    const fixture = storageFixture();
    const outcome = await removeUserStorage({ storage: fixture.storage } as unknown as SupabaseClient, "person");

    expect(outcome).toEqual({ ok: true });
    expect(fixture.listed).toContain("media:person/chat:100");
    expect(fixture.removed.flatMap(({ paths }) => paths)).toHaveLength(101);
    expect(fixture.removed[0].paths[0]).toBe("person/chat/image-000.jpg");
    expect(fixture.removed.map(({ paths }) => paths.length)).toEqual([100, 1]);
    expect(new Set(fixture.listed.map((entry) => entry.split(":")[0]))).toEqual(
      new Set(["avatars", "media", "wallpapers", "verification-evidence"])
    );
  });

  it("stops before deleting database rows or Auth when storage fails", async () => {
    const fixture = storageFixture({ failBucket: "wallpapers" });
    const deleteUser = vi.fn();
    const deleteRows = vi.fn();
    const admin = {
      storage: fixture.storage,
      auth: { admin: { deleteUser } },
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from(table: string) {
        if (table === "account_deletion_requests") return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) })
        };
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          delete: deleteRows
        };
      }
    };

    const result = await deleteAccountForUser(admin as unknown as SupabaseClient, "person", null);
    expect(result).toMatchObject({ ok: false, stage: "reports_anonymised", resumable: true });
    expect(deleteRows).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("account deletion failure and retry boundaries", () => {
  it("tombstones only the deleting author's messages before erasing profile/Auth", async () => {
    const f = workflowFixture();
    await expect(deleteAccountForUser(f.admin, "person", null)).resolves.toEqual({ ok: true, stage: "auth_removed" });
    const messageAt = f.calls.findIndex((c) => c.table === "messages");
    const profileAt = f.calls.findIndex((c) => c.table === "profiles" && c.operation === "delete");
    expect(messageAt).toBeLessThan(profileAt);
    expect(f.calls[messageAt]).toMatchObject({ operation: "update", value: { status: "deleted", text_content: null, media_id: null }, filter: [["sender_id", "person"]] });
    expect(f.deleteUser).toHaveBeenCalledWith("person");
    expect(f.calls.at(-1)).toMatchObject({ table: "account_deletion_requests", operation: "delete", filter: [["user_id", "person"]] });
  });
  it("does not remove Auth or the intent after a data failure", async () => {
    const f = workflowFixture({ failTable: "messages" });
    await expect(deleteAccountForUser(f.admin, "person", null)).resolves.toMatchObject({ ok: false, resumable: true });
    expect(f.deleteUser).not.toHaveBeenCalled();
    expect(f.calls.some((c) => c.table === "profiles" && c.operation === "delete")).toBe(false);
    expect(f.calls.some((c) => c.table === "account_deletion_requests" && c.operation === "delete")).toBe(false);
  });
  it("retains the request and reports partial completion when Auth removal fails", async () => {
    const f = workflowFixture({ authFailure: true });
    await expect(deleteAccountForUser(f.admin, "person", null)).resolves.toMatchObject({ ok: false, stage: "audited", resumable: true });
    expect(f.calls.some((c) => c.table === "account_deletion_requests" && c.operation === "delete")).toBe(false);
    f.deleteUser.mockResolvedValue({ error: null });
    await expect(deleteAccountForUser(f.admin, "person", null)).resolves.toMatchObject({ ok: true });
    expect(f.calls.filter((c) => c.table === "deletion_audit_logs" && c.operation === "insert")).toHaveLength(1);
  });
  it("does not silently skip Conference cleanup when its readiness lookup fails", async () => {
    const f = workflowFixture({ featureFailure: true });
    await expect(purgeUserData(f.admin, "person")).resolves.toEqual({ ok: false, failedTable: "feature_flags" });
    expect(f.calls.some((c) => c.operation === "delete")).toBe(false);
  });
  it("preserves the profile when a scoped purge fails", async () => {
    const f = workflowFixture({ failTable: "notifications" });
    await expect(purgeUserData(f.admin, "person")).resolves.toEqual({ ok: false, failedTable: "notifications" });
    expect(f.calls.some((c) => c.table === "profiles")).toBe(false);
  });
});
