import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("signed-in About navigation", () => {
  it("keeps app links inside the protected app shell", () => {
    expect(read("components/settings/settings-page.tsx")).toContain('href="/settings/about"');
    expect(read("components/dashboard/home-settings-sheet.tsx")).toContain('href: "/settings/about", label: "About Mad Buddy"');
    expect(read("app/(app)/settings/about/page.tsx")).toContain("SettingsSubHeader");
  });

  it("has a return route but no login or signup controls", () => {
    const about = read("app/(app)/settings/about/page.tsx");
    expect(about).toContain('href: "/settings", label: "Back to Settings"');
    expect(about).not.toContain('href="/login"');
    expect(about).not.toContain('href="/signup"');
    expect(read("app/about/page.tsx")).toContain("<AboutPage />");
  });
});
