import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const section = css.slice(css.indexOf("/* A PWA has app chrome"), css.indexOf("/* The slim visible scrollbar"));

describe("touch long-press selection", () => {
  it("suppresses selection and callouts only on app controls", () => {
    expect(section).toContain("@media (pointer: coarse)");
    expect(section).toContain("[data-app-shell] {");
    expect(readFileSync("components/app-shell/app-shell.tsx", "utf8")).toContain("data-app-shell");
    expect(section).toContain("button, summary");
    expect(section).toContain('nav a');
    expect(section).toContain("-webkit-user-select: none");
    expect(section).toContain("-webkit-touch-callout: none");
  });

  it("preserves selection in messages, content, and editing fields", () => {
    expect(section).toContain("p, article, blockquote, pre, code, input, textarea, [contenteditable]");
    expect(section).toContain("[data-selectable-text], .select-text");
    expect(section).toContain("user-select: text");
    expect(section).not.toContain("html, body");
    expect(section).not.toContain("* {");
  });
});
