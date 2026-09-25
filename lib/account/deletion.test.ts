import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteAccountForUser, removeUserStorage } from "./deletion";

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
