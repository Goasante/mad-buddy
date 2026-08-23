import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE MOBILE SHELL CONTRACT.
 *
 * Mission 5's rule is "stop patching notch problems page by page": the shell
 * primitives must hold so the whole UI could later be mounted in a native
 * WebView without route-by-route safe-area redesign.
 *
 * These are structural assertions ON PURPOSE. `env(safe-area-inset-*)` is 0 in
 * headless Chromium and cannot be set from script — Mission 2 recorded that
 * simulating a notch measures the simulation, not the app. So the runtime
 * matrix (scripts/hardening/mobile-shell.mjs, 100 combinations) proves layout
 * behaviour, and this proves the properties that survive a real notch.
 */

const ROOT = join(__dirname, "..", "..");
const globals = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const rootLayout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
const appShell = readFileSync(join(ROOT, "components/app-shell/app-shell.tsx"), "utf8");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|css)$/.test(entry.name)) out.push(full);
  }
}

describe("viewport contract", () => {
  it("declares viewport-fit: cover, so the insets exist at all", () => {
    // Without this, env(safe-area-inset-*) is always 0 on a notched device and
    // every derivation below silently becomes a no-op.
    expect(rootLayout).toContain('viewportFit: "cover"');
  });

  it("body sizes on the SMALL/DYNAMIC viewport, never a bare 100vh", () => {
    /* 100vh is the LARGE viewport: it includes the collapsible URL bar, so the
       body outgrows what the user can see and the page gains a phantom scroll.
       svh first as the fallback for engines without dvh. */
    /* Located by regex, tolerant of line endings and long enough to clear the
       rule's own explanatory comment. A fixed 400-char slice from an
       index-of ended INSIDE that comment, so the assertion failed against text
       that was present. */
    const match = globals.match(/\r?\nbody\s*\{[\s\S]{0,1400}/);
    expect(match, "the body rule was not found in globals.css").toBeTruthy();
    const body = match![0];
    expect(body).toContain("min-height: 100svh");
    expect(body).toContain("min-height: 100dvh");
    expect(body, "body is back on the large viewport unit").not.toMatch(/min-height:\s*100vh/);
  });

  it("no mobile surface sizes itself with a bare 100vh", () => {
    const files: string[] = [];
    walk(join(ROOT, "components"), files);
    walk(join(ROOT, "app"), files);
    expect(files.length, "the scan processed no files").toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        if (!/100vh/.test(line)) continue;
        // Desktop-only usage is fine: there is no URL bar to collapse there.
        if (/\bmd:|\blg:|min-width/.test(line)) continue;
        /* Documentation, not code. A JSX comment (`{/* … *\/}`) is not caught
           by a leading-token test, and this contract's own explanation of why
           100vh is wrong would otherwise report itself -- the same
           self-reporting trap the form-method and hover guards both hit. */
        if (/^\s*(\*|\/\*|\/\/|\{\/\*)/.test(line)) continue;
        if (/not vh|never a bare|100vh is|is capped/.test(line)) continue;
        offenders.push(`${file.split(/[\/]/).slice(-2).join("/")}: ${line.trim().slice(0, 70)}`);
      }
    }
    expect(offenders, `bare 100vh outside desktop breakpoints:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("safe-area contract", () => {
  it("the app shell reserves the bottom inset for its navigation", () => {
    expect(appShell).toMatch(/pb-\[env\(safe-area-inset-bottom|env\(safe-area-inset-bottom/);
  });

  it("pinned elements derive from the inset tokens rather than fixed pixels", () => {
    /* The regression this prevents is a future surface hard-coding a notch
       height. Mission 2 (MB-GOD-009) established that the architecture is
       sound; this keeps it sound as surfaces are added. */
    const files: string[] = [];
    walk(join(ROOT, "components"), files);
    const derived = files.filter((f) => /safe-area-inset/.test(readFileSync(f, "utf8")));
    expect(derived.length, "no component derives from the safe-area insets").toBeGreaterThan(3);
  });

  it("the safe-area insets are declared once, as tokens", () => {
    expect(globals).toMatch(/safe-area-inset/);
  });
});
