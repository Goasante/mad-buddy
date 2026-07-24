import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260724190000_moment_video_support.sql"),
  "utf8"
);

describe("Moment video migration", () => {
  it("adds video without removing existing image and audio media types", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "audio/webm",
      "audio/mpeg",
      "video/mp4",
      "video/webm",
      "video/quicktime"
    ]) {
      expect(sql).toContain(`'${type}'`);
    }
  });

  it("requires a media asset for a video Moment", () => {
    expect(sql).toContain("content_type in ('photo', 'video') and media_id is not null");
  });

  it("keeps the storage bucket private and does not add location data", () => {
    expect(sql).not.toMatch(/public\s*=\s*true/i);
    expect(sql).not.toMatch(/\b(latitude|longitude|coordinates|geohash)\b/i);
  });
});
