import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const toast = fs.readFileSync(
  path.join(ROOT, "components/notifications/live-signal-toast.tsx"),
  "utf8"
);

describe("live signal interaction feedback", () => {
  it("uses the shared semantic feedback layer instead of calling vibration directly", () => {
    expect(toast).toContain('from "@/lib/feedback/feedback"');
    expect(toast).toContain("feedback.achievement()");
    expect(toast).toContain("feedback.wave()");
    expect(toast).not.toContain("navigator.vibrate");
  });

  it("keeps the achievement celebration grounded in the canonical catalog", () => {
    expect(toast).toContain("ACHIEVEMENT_BY_CODE.get(parsed.code)");
    expect(toast).toContain("detail: definition.description");
    expect(toast).toContain('href: "/badges" as Route');
    expect(toast).toContain("badgeIconPath: definition.iconPath");
  });

  it("marks the rendered signal kind for visual/native diagnostics", () => {
    expect(toast).toContain("data-live-signal-kind={signal.kind}");
  });
});
