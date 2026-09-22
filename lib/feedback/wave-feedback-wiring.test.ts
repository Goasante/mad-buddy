import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const modal = fs.readFileSync(
  path.join(ROOT, "components/glow/muddy-profile-modal.tsx"),
  "utf8"
);

describe("Muddy profile interaction feedback", () => {
  it("fires Wave feedback only after the canonical action succeeds", () => {
    expect(modal).toContain("const result = await sendWaveV2Action(friendId, \"profile\")");
    expect(modal).toContain("if (result.ok) {");
    expect(modal).toContain("feedback.wave()");
    expect(modal).toContain("setWaveSent(true)");
  });

  it("uses error feedback for failed Wave/message actions", () => {
    expect(modal.match(/feedback\.error\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("uses the lightest selection feedback for choosing a Ping prompt", () => {
    expect(modal).toContain("feedback.selection()");
  });
});
