import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Meetups mobile web layout", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components/meetups/meetup-page.tsx"),
    "utf8"
  );

  it("keeps web controls in flow without a second mobile header inset", () => {
    const controlsClass = source.match(
      /PLATFORM_KIND === "web"\s*\? "([^"]+)"\s*:\s*"sticky top-0/
    )?.[1];
    expect(controlsClass).toBeDefined();
    expect(controlsClass).toContain("relative");
    expect(controlsClass).not.toMatch(/\b(sticky|fixed|top-\S+)\b/);
    expect(source).not.toContain("sticky top-[var(--mobile-header-height)]");
  });

  it("leaves card spacing in normal flow below the controls", () => {
    expect(source).toContain('{controls}\n      </div>\n\n      <div className="px-3 pt-4 sm:px-4">');
  });
});
