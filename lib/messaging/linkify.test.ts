import { describe, expect, it } from "vitest";
import { tokenizeMessageText } from "@/lib/messaging/linkify";

describe("safe message linkification", () => {
  it("turns a canonical Event share into an internal route", () => {
    expect(tokenizeMessageText("Join https://mad-buddy.com/events/123."))
      .toEqual([
        { kind: "text", value: "Join " },
        { kind: "link", value: "https://mad-buddy.com/events/123", href: "/events/123", internal: true },
        { kind: "text", value: "." }
      ]);
  });

  it("opens external HTTP(S) separately", () => {
    expect(tokenizeMessageText("https://example.com/a?q=1")[0]).toMatchObject({
      kind: "link", internal: false, href: "https://example.com/a?q=1"
    });
  });

  it("never promotes executable or malformed schemes", () => {
    for (const text of ["javascript:alert(1)", "data:text/html,<script>x</script>", "<b>hello</b>"]) {
      expect(tokenizeMessageText(text).every((token) => token.kind === "text")).toBe(true);
    }
  });
});
