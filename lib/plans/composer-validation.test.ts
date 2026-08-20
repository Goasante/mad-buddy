import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";

/**
 * Creating a Plan that the server refuses.
 *
 * THE FAILURE THIS PINS. A refused Plan reported itself through the page-level
 * feedback banner -- which is rendered UNDER the composer modal. So the person
 * saw the form simply not submit: no error, no explanation, no indication that
 * anything had happened at all. A missing field is not a missing page, but an
 * invisible refusal is barely better than one.
 */

const source = stripComments(readFileSync("components/plans/plans-page.tsx", "utf8"));
const flat = stripFormatting(readFileSync("components/plans/plans-page.tsx", "utf8"));

/** The create handler, bounded to itself rather than a character window. */
const createHandler = source.slice(
  // From the function itself, not from the action call: setIsCreating(true)
  // runs BEFORE the await, and a slice starting at the call cannot see it.
  source.indexOf("void (async () => {"),
  source.indexOf("const inviteCount")
);

describe("a refused Plan stays in the composer and says why", () => {
  it("does not navigate when the server refuses", () => {
    /* Navigation is gated on the server's answer, and the failure branch
     * returns before any of it. */
    expect(createHandler).toContain("if (!result.ok) {");
    const failureBranch = createHandler.slice(
      createHandler.indexOf("if (!result.ok) {"),
      createHandler.indexOf("createRequestKeyRef.current = null;")
    );
    expect(failureBranch).toContain("return;");
    for (const escape of ["router.push", "router.replace", "window.location", "notFound"]) {
      expect(failureBranch, escape).not.toContain(escape);
    }
  });

  it("does not close the composer or discard what was typed", () => {
    const failureBranch = createHandler.slice(
      createHandler.indexOf("if (!result.ok) {"),
      createHandler.indexOf("createRequestKeyRef.current = null;")
    );
    expect(failureBranch).not.toContain("setCreateOpen(false)");
  });

  it("shows the reason INSIDE the sheet, not on the page behind it", () => {
    /* The whole defect: `feedback` renders at page level and the modal is
     * layered over it. `error` is passed into the composer and rendered in its
     * body, where the person is actually looking. */
    expect(createHandler).toContain("setCreateError(result.message);");
    expect(flat).toContain("error={createError}");
    expect(flat).toContain('<p role="alert"');
  });

  it("announces the refusal rather than only showing it", () => {
    // A silent visual change tells a screen-reader user nothing.
    expect(flat).toContain('role="alert"');
  });
});

describe("creating a Plan is a mutation, not interruptible work", () => {
  it("runs outside startTransition", () => {
    /* THE SYSTEMIC BUG. React abandons transition work by design, killing the
     * Server Action mid-flight -- and the person cannot tell whether their
     * Plan was created. A write must be allowed to finish. */
    expect(createHandler).not.toContain("startTransition");
    expect(flat).toContain("void (async () => { setIsCreating(true);");
  });

  it("owns an explicit pending flag and clears it on every path", () => {
    expect(createHandler).toContain("setIsCreating(true);");
    expect(createHandler).toContain("setIsCreating(false);");
    // Cleared BEFORE the branch, so both the refusal and the success clear it.
    const clearAt = createHandler.indexOf("setIsCreating(false);");
    const branchAt = createHandler.indexOf("if (!result.ok) {");
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(branchAt);
  });

  it("still reports pending to the composer", () => {
    expect(flat).toContain("pending={isPending || isCreating}");
  });
});
