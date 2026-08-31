import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mobile web layout hardening", () => {
  it("keeps Apple standalone metadata and opts into safe-area viewport handling", () => {
    const layout = source("app/layout.tsx");
    expect(layout).toContain('statusBarStyle: "black-translucent"');
    expect(layout).toContain('viewportFit: "cover"');
  });

  it("applies top and bottom safe areas to authenticated mobile chrome", () => {
    const shell = source("components/app-shell/app-shell.tsx");
    expect(shell).toContain("safe-area-inset-top");
    expect(shell).toContain("safe-area-inset-bottom");
  });

  it("uses dynamic mobile viewport units for authentication and onboarding", () => {
    for (const path of [
      "components/front-door/auth-shell.tsx",
      "components/onboarding/onboarding-flow.tsx",
      "app/(admin-auth)/admin/login/page.tsx"
    ]) {
      const text = source(path);
      expect(text).toContain("min-h-[100svh]");
      expect(text).toContain("min-h-[100dvh]");
    }
  });

  it("keeps shared icon buttons at a 44px hit area", () => {
    const button = source("components/ui/button.tsx");
    expect(button).toContain('icon: "h-11 w-11');
    expect(button).toContain('sm: "h-11');
  });
});
