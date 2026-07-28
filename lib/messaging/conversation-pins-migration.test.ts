import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260728140000_conversation_pins.sql"),
  "utf8"
).toLowerCase();

describe("conversation pins migration", () => {
  it("creates a per-user pin table keyed by (user_id, conversation_id)", () => {
    expect(sql).toContain("create table if not exists public.conversation_pins");
    expect(sql).toContain("primary key (user_id, conversation_id)");
    expect(sql).toContain("references auth.users(id) on delete cascade");
    expect(sql).toContain("references public.conversations(id) on delete cascade");
  });

  it("stores no message content — only the pin relationship", () => {
    for (const forbidden of ["text_content", "message_text", "body", "preview", "bytea"]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("enables RLS: owner-only reads, writes service-role only", () => {
    expect(sql).toContain("alter table public.conversation_pins enable row level security");
    expect(sql).toContain("for select using (auth.uid() = user_id)");
    expect(sql).toContain("revoke insert, update, delete on table public.conversation_pins from anon, authenticated");
  });
});
