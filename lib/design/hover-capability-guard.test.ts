import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankComments,
  findHoverHiddenSites,
  scanWithCount
} from "@/lib/design/hover-capability-guard";

/**
 * Hover is a pointer capability, and a finger does not have one.
 *
 * MB-GOD-040: the message action row was `opacity-0 group-hover:opacity-100`,
 * which on every touch device meant three invisible-but-tappable controls and
 * an emoji picker that the long-press menu's `React` item opened to nothing.
 *
 * The guard exists because that defect is INVISIBLE while reading the JSX and
 * invisible on the machine a developer is using. These tests hold the guard to
 * the standard the program set: if the defect were reintroduced, does this
 * fail?
 */

const REPO = join(__dirname, "..", "..");

describe("hover-capability guard: detection", () => {
  it("catches the exact shape that shipped", () => {
    // The real className from messages-page.tsx before the fix.
    const source = `
      <div className={cn(
        "mt-0.5 flex items-center gap-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        message.isMine ? "justify-end" : "justify-start"
      )}>
    `;
    const sites = findHoverHiddenSites(source, "messages-page.tsx");
    expect(sites, "the shipped defect shape was not detected").toHaveLength(1);
  });

  it("catches the same shape split across lines", () => {
    /* A long class list is usually wrapped by the formatter, so a detector that
       only reads single lines would miss the majority of real occurrences. */
    const source = `
      <div className={cn(
        "opacity-0",
        "transition-opacity",
        "group-hover:opacity-100"
      )}>
    `;
    expect(findHoverHiddenSites(source, "x.tsx")).toHaveLength(1);
  });

  it("catches `invisible` as well as `opacity-0`", () => {
    const source = `<div className="invisible group-hover:visible">`;
    expect(findHoverHiddenSites(source, "x.tsx")).toHaveLength(1);
  });

  it("does NOT flag decorative hover changes", () => {
    /* Losing a colour or scale transition costs a touch user nothing: the
       control was visible the whole time. Flagging these would make the guard
       noisy enough to be ignored, which is how guards die. */
    for (const source of [
      `<button className="text-muted-foreground group-hover:text-foreground">`,
      `<div className="scale-100 group-hover:scale-105">`,
      `<span className="bg-card hover:bg-secondary/60">`,
      `<div className="opacity-70 group-hover:opacity-100">`
    ]) {
      expect(findHoverHiddenSites(source, "x.tsx"), source).toHaveLength(0);
    }
  });

  it("does not flag an element hidden at rest with no hover reveal at all", () => {
    // Hidden for some other reason (a state toggle, an animation) is not this
    // defect and is not this guard's business.
    const source = `<div className="opacity-0 transition-opacity">`;
    expect(findHoverHiddenSites(source, "x.tsx")).toHaveLength(0);
  });
});

describe("hover-capability guard: comment handling", () => {
  it("does not report its own documentation", () => {
    /* The form guard reported `login-form.tsx:98` on its first run -- a comment
       explaining the defect, which quoted the very tag it searched for. Same
       technique, same reason. */
    const source = `
      // A comment mentioning opacity-0 and group-hover:opacity-100 together.
      /* And a block one: opacity-0 group-hover:opacity-100 */
      <div className="flex items-center">
    `;
    expect(findHoverHiddenSites(source, "x.tsx")).toHaveLength(0);
  });

  it("blanks comments while preserving line numbers", () => {
    const source = "const a = 1;\n// hidden\nconst b = 2;";
    const scrubbed = blankComments(source);
    expect(scrubbed.split("\n")).toHaveLength(3);
    expect(scrubbed).toContain("const a = 1;");
    expect(scrubbed).toContain("const b = 2;");
    expect(scrubbed).not.toContain("hidden");
  });

  it("does not mistake a class string for a comment", () => {
    // `//` inside a URL or a string must not start a comment.
    const source = `<a href="https://example.com" className="opacity-0 group-hover:opacity-100">`;
    expect(findHoverHiddenSites(source, "x.tsx")).toHaveLength(1);
  });
});

describe("hover-capability guard: the app itself", () => {
  it("scans a real number of files, so a clean result means something", () => {
    /* "Zero files scanned must fail." A scan pointed at the wrong directory
       finds nothing and would otherwise report perfect health. */
    const { scanned } = scanWithCount([join(REPO, "components"), join(REPO, "app")], REPO);
    expect(scanned, "the scan processed no files").toBeGreaterThan(100);
  });

  it("finds no control hidden at rest behind a hover-only reveal", () => {
    const { sites, scanned } = scanWithCount(
      [join(REPO, "components"), join(REPO, "app")],
      REPO
    );
    const report = sites.map((s) => `${s.file}:${s.line}  ${s.source}`).join("\n");
    expect(sites, `hover-gated hidden controls (${scanned} files scanned):\n${report}`).toHaveLength(0);
  });
});
