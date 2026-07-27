import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260728120000_wallpaper_personalization.sql"),
  "utf8"
).toLowerCase();

describe("wallpaper personalization migration", () => {
  it("creates the catalog, preference, and custom-metadata tables", () => {
    expect(sql).toContain("create table if not exists public.wallpapers");
    expect(sql).toContain("create table if not exists public.user_wallpaper_preferences");
    expect(sql).toContain("create table if not exists public.custom_wallpapers");
  });

  it("gates catalog tier as data with a hierarchical set of plans", () => {
    expect(sql).toContain("tier text not null default 'free' check (tier in ('free', 'buddy_plus', 'buddy_pro'))");
    expect(sql).toContain("render_mode text not null check (render_mode in ('ambient', 'plain', 'image'))");
  });

  it("seeds the bundled catalog (default, plain, and the free gallery)", () => {
    for (const slug of ["mad-buddy-default", "plain", "wallpaper-01", "wallpaper-04"]) {
      expect(sql).toContain(`'${slug}'`);
    }
    expect(sql).toContain("on conflict (slug) do nothing");
    expect(sql).toContain("/wallpapers/gallery/wallpaper-01.webp");
  });

  it("stores custom uploads as metadata only — never blobs", () => {
    expect(sql).toContain("storage_key text not null unique");
    expect(sql).toContain("mime_type text not null");
    expect(sql).toContain("size_bytes integer not null");
    for (const forbidden of ["bytea", "base64", "blob", "image_data"]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("keeps one active personal wallpaper per owner", () => {
    expect(sql).toContain("custom_wallpapers_one_active_per_owner");
    expect(sql).toContain("where (state = 'active')");
  });

  it("enables RLS and keeps writes service-role only", () => {
    expect(sql).toContain("alter table public.wallpapers enable row level security");
    expect(sql).toContain("alter table public.user_wallpaper_preferences enable row level security");
    expect(sql).toContain("alter table public.custom_wallpapers enable row level security");
    expect(sql).toContain("revoke insert, update, delete on table public.user_wallpaper_preferences from anon, authenticated");
    expect(sql).toContain("revoke insert, update, delete on table public.custom_wallpapers from anon, authenticated");
  });

  it("lets a user read only their own preference and uploads", () => {
    expect(sql).toContain("for select using (auth.uid() = user_id)");
    expect(sql).toContain("for select using (auth.uid() = owner_id)");
    expect(sql).toContain("is_enabled = true"); // enabled catalog readable
  });

  it("uses a PRIVATE storage bucket with owner-scoped object policies", () => {
    expect(sql).toContain("insert into storage.buckets (id, name, public)");
    expect(sql).toContain("values ('wallpapers', 'wallpapers', false)");
    expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });
});
