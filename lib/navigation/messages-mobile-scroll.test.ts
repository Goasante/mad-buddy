import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/mobile-shell-stability.css"), "utf8");

describe("Messages mobile scroll ownership", () => {
  it("keeps the Messages chrome outside the scrolling conversation list", () => {
    expect(css).toContain(".messages-page [data-chat-inbox]");
    expect(css).toContain(".messages-page [data-chat-inbox] aside:not(.hidden)");
    expect(css).toContain("flex-direction: column");
    expect(css).toContain("overflow: hidden");
  });

  it("makes the conversation rows the vertical scroll owner with bottom clearance", () => {
    expect(css).toContain("aside:not(.hidden) > div:last-child");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overscroll-behavior-y: contain");
    expect(css).toContain("scroll-padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px))");
  });
});
