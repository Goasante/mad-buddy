import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";
import {
  MAX_PROFILE_PHOTOS,
  batchOutcomeMessage,
  remainingPhotoSlots,
  selectPhotoBatch
} from "@/lib/profile/profile-photos";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";

/**
 * Adding showcase photos in one go.
 *
 * The reported complaint: the picker took one file at a time, so filling three
 * slots meant three separate trips into the camera roll.
 */

const photo = (position: number): ProfilePhoto => ({
  id: `p${position}`,
  position,
  url: `https://example.test/${position}.jpg`,
  visibility: "everyone"
});

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

describe("how many more will fit", () => {
  it("counts down from the cap as photos are added", () => {
    expect(remainingPhotoSlots([])).toBe(3);
    expect(remainingPhotoSlots([photo(0)])).toBe(2);
    expect(remainingPhotoSlots([photo(0), photo(1)])).toBe(1);
    expect(remainingPhotoSlots([photo(0), photo(1), photo(2)])).toBe(0);
    expect(MAX_PROFILE_PHOTOS).toBe(3);
  });
});

describe("choosing more than will fit", () => {
  it("takes what fits and says what did not", () => {
    /* THE RULE: over-selection is never silently trimmed. Taking the first two
     * without a word means the person believes they added four photos and
     * finds two, with no way to know which are missing. */
    const decision = selectPhotoBatch([file("a"), file("b"), file("c"), file("d")], [photo(0)]);
    expect(decision.accepted).toHaveLength(2);
    expect(decision.rejected).toHaveLength(2);
    expect(decision.message).toContain("up to 3 showcase photos");
    expect(decision.message).toContain("2 were not included");
  });

  it("says nothing when everything fits", () => {
    const decision = selectPhotoBatch([file("a"), file("b")], []);
    expect(decision.accepted).toHaveLength(2);
    expect(decision.rejected).toHaveLength(0);
    expect(decision.message).toBeNull();
  });

  it("refuses the whole selection when the gallery is full", () => {
    const decision = selectPhotoBatch([file("a")], [photo(0), photo(1), photo(2)]);
    expect(decision.accepted).toHaveLength(0);
    expect(decision.message).toContain("Remove one first");
  });

  it("keeps the chosen order", () => {
    const [a, b, c] = [file("a"), file("b"), file("c")];
    expect(selectPhotoBatch([a, b, c], []).accepted.map((f) => f.name)).toEqual(["a", "b", "c"]);
  });
});

describe("what a finished batch says", () => {
  it("does not throw away the successes when one fails", () => {
    /* 2 of 3 landing is a success AND a failure. Reporting it as either alone
     * is a lie: "failed" hides two real photos, "added" hides a missing one. */
    const message = batchOutcomeMessage(2, 1);
    expect(message).toContain("2 added");
    expect(message).toContain("1 could not be added");
    expect(message).toContain("retry");
  });

  it("stays plain when everything worked", () => {
    expect(batchOutcomeMessage(1, 0)).toBe("Photo added.");
    expect(batchOutcomeMessage(3, 0)).toBe("3 photos added.");
  });

  it("does not claim success when nothing landed", () => {
    expect(batchOutcomeMessage(0, 2)).toContain("could not be added");
    // Must not read as a partial success: no "N added" clause.
    expect(batchOutcomeMessage(0, 2)).not.toMatch(/\d+ added/);
  });
});

// ---------------------------------------------------------------------------
// The picker itself
// ---------------------------------------------------------------------------

describe("the picker allows one trip through the camera roll", () => {
  const source = stripComments(readFileSync("components/profile/profile-photo-carousel.tsx", "utf8"));
  const flat = stripFormatting(readFileSync("components/profile/profile-photo-carousel.tsx", "utf8"));

  it("accepts multiple files in one interaction", () => {
    expect(flat).toContain('type="file" accept="image/*" multiple');
  });

  it("reads every chosen file, not just the first", () => {
    // `files?.[0]` is exactly the defect: it discarded the rest of a selection.
    expect(source).not.toContain("event.target.files?.[0]");
    expect(source).toContain("chooseFiles(");
  });

  it("uploads OUTSIDE a transition, so the request cannot be abandoned", () => {
    /* THE SYSTEMIC BUG. startTransition marks work interruptible and React
     * really does abandon it -- killing an in-flight Server Action, which
     * escapes to the app-wide error boundary as "This page could not be
     * opened". An upload is a mutation and must finish. */
    const upload = source.slice(source.indexOf("const uploadOne"), source.indexOf("const uploadBatch"));
    expect(upload).not.toContain("startTransition");
    expect(upload).toContain("await addProfilePhotoAction(form)");
  });

  it("keeps the successful photos when part of a batch fails", () => {
    const batch = source.slice(source.indexOf("const uploadBatch"), source.indexOf("const chooseFiles"));
    expect(batch).toContain('status: ok ? "done" : "failed"');
    // Only the failures stay in the tray; the rest have served their purpose.
    expect(batch).toContain('current.filter((item) => item.status === "failed")');
  });

  it("clears its pending state on every path", () => {
    const batch = source.slice(source.indexOf("const uploadBatch"), source.indexOf("const chooseFiles"));
    expect(batch).toContain("setUploading(true)");
    expect(batch).toContain("setUploading(false)");
    // A rejected file must not abandon the loop and strand the flag.
    expect(batch).toContain("catch(() => false)");
  });

  it("never navigates away from Profile on success or failure", () => {
    /* §12. Scoped to the WHOLE upload path, and checking every way a page can
     * be left -- the first version sliced only as far as chooseFiles and
     * looked for router.* alone, so a `window.location.assign` on the failure
     * branch slipped straight through the test. */
    const start = source.indexOf("const uploadOne");
    const end = source.indexOf("function setVisibility");
    const upload = source.slice(start, end > start ? end : undefined);
    expect(start).toBeGreaterThan(-1);
    for (const escape of [
      "router.push",
      "router.replace",
      "notFound",
      "window.location",
      "redirect("
    ]) {
      expect(upload, escape).not.toContain(escape);
    }
  });
});
