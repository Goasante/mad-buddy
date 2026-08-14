import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Back goes where the person came from.
 *
 * THE REPORTED DEFECT. A Circle chat's Back control was a hardcoded
 * <Link href="/groups">, so opening a Circle from the Messages inbox and
 * pressing Back dropped you on the Circles list -- somewhere you had never
 * been. The label also still read "Groups", the pre-rename word.
 *
 * A Circle chat is reachable from the Messages inbox, the Circles list, a
 * notification and a cold deep link. Only one of those wants /groups.
 */

const circle = stripComments(readFileSync("components/groups/group-detail-page.tsx", "utf8"));
const messages = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));

/**
 * The back control's handler ONLY.
 *
 * Asserting against the whole file is not enough: the explanatory comment
 * above the control mentions router.back(), so a mutation that deleted the
 * real call still left the string present and the test still passed. Scoping
 * to the handler is what makes these assertions bite.
 */
const backHandler = (() => {
  const start = circle.indexOf("<ChevronLeft");
  const open = circle.lastIndexOf("<button", start);
  return circle.slice(open, start);
})();

describe("Circle chat back navigation", () => {
  it("does not hardcode a link to the Circles list", () => {
    expect(circle).not.toContain('<Link href="/groups"');
  });

  it("returns through history when the page was reached from inside the app", () => {
    expect(backHandler).toContain("router.back()");
  });

  it("falls back to a canonical destination on a cold deep link", () => {
    // A fresh tab has nothing to go back to; router.back() there would leave
    // the app entirely or do nothing at all.
    expect(backHandler).toContain("cameFromInsideApp");
    expect(backHandler).toContain('router.push("/groups")');
  });

  it("does not send everyone to the Circles list unconditionally", () => {
    // The original defect, stated directly: a push with no history branch.
    expect(backHandler).not.toMatch(/onClick=\{\(\) => \{\s*router\.push\("\/groups"\);\s*\}\}/);
  });

  it("decides entry context once, on mount", () => {
    // history.length grows as the person moves around inside the Circle, so
    // reading it at click time answers a different question.
    expect(circle).toContain("useState(() => {");
  });

  it("uses the renamed vocabulary", () => {
    // "Groups" is the pre-rename product word; the control is now neutral.
    const backControl = circle.slice(circle.indexOf("<ChevronLeft") - 700, circle.indexOf("<ChevronLeft") + 200);
    expect(backControl).not.toContain(">\n          Groups");
  });
});

describe("direct thread back navigation is unchanged", () => {
  it("still closes the conversation through its own history entry", () => {
    // The DM thread is page-level UI inside /messages rather than a route, and
    // already had a working convention. This audit must not disturb it.
    expect(messages).toContain("mbConversation");
    expect(messages).toContain("window.history.back()");
  });
});
