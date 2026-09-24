import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const section = css.slice(css.indexOf("/* Touch-first app chrome"), css.indexOf("/* The slim visible scrollbar"));

describe("touch long-press selection", () => {
  it("suppresses selection and callouts only on app controls", () => {
    expect(section).toContain("@media (pointer: coarse)");
    expect(section).toContain("button, summary");
    expect(section).toContain('nav a');
    expect(section).toContain("-webkit-user-select: none");
    expect(section).toContain("-webkit-touch-callout: none");
  });

  it("preserves selection in messages, content, and editing fields", () => {
    expect(section).not.toMatch(/\b(html|body|main|article|p|input|textarea|\[contenteditable\])\b\s*[,){]/);
    expect(section).not.toContain("* {");
  });
});
