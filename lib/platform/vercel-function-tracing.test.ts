import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("next.config.ts", "utf8");

describe("Vercel function tracing", () => {
  it("does not force Sharp into every server function", () => {
    expect(config).not.toMatch(/["']\/\*["']\s*:\s*sharpRuntimeFiles/);
  });

  it("keeps Sharp available on every image-processing surface", () => {
    for (const route of [
      "/profile",
      "/events",
      "/moments",
      "/groups",
      "/groups/**",
      "/messages",
      "/messages/**",
      "/settings/appearance/wallpaper",
      "/api/profile/avatar/upload",
      "/api/profile/photos",
      "/api/messages/media"
    ]) {
      expect(config).toContain(`"${route}": sharpRuntimeFiles`);
    }

    expect(config).toContain('"./node_modules/sharp/**/*"');
    expect(config).toContain('"./node_modules/@img/sharp-linux-x64/**/*"');
    expect(config).toContain('"./node_modules/@img/sharp-libvips-linux-x64/**/*"');
  });
});
