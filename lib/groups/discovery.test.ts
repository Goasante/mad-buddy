import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const web = stripComments(read("app/(app)/group-actions.ts"));
const mobile = stripComments(read("lib/groups/mobile.ts"));
const retirement = read("supabase/migrations/20260923140000_retire_public_group_discovery.sql");
const linkr = stripComments(read("app/(app)/linkr/page.tsx"));

describe("public Group discovery is retired", () => {
  it("converts every existing public Group back to private", () => {
    expect(retirement).toContain("update public.group_settings");
    expect(retirement).toContain("where visibility = 'public'");
    expect(retirement).toContain("set visibility = 'private'");
  });

  it("removes the database read path that exposed public Group settings", () => {
    expect(retirement).toContain('drop policy if exists "public groups discoverable"');
    expect(retirement).toContain("drop index if exists public.group_settings_public_discovery_idx");
  });

  it("makes private visibility durable at the database boundary", () => {
    expect(retirement).toContain("group_settings_visibility_private_only_check");
    expect(retirement).toContain("check (visibility = 'private')");
  });

  it("returns no discoverable feed from either web or native compatibility services", () => {
    expect(web).toContain("return { groups, discoverableGroups: [], invitations }");
    expect(mobile).toContain("return { groups, discoverableGroups: [], invitations }");
    expect(web).not.toContain("publicSettingsResult");
    expect(mobile).not.toContain("publicSettingsResult");
  });

  it("forces creation private and invite-only on both transports", () => {
    for (const source of [web, mobile]) {
      const create = source.slice(source.indexOf("createGroup"));
      expect(create).toContain('visibility: "private"');
      expect(create).toContain('join_mode: "invite"');
    }
  });

  it("keeps current Linkr people-first and free of a Group feed", () => {
    expect(linkr).not.toContain("discoverableGroups");
    expect(linkr).not.toContain("SocializeGroupCard");
    expect(linkr).not.toContain("public groups");
  });
});
