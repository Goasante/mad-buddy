import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";

/**
 * Mutations are not interruptible work (Batch 2: Profile, Muddies, Linkr).
 *
 * THE SYSTEMIC BUG. startTransition marks work as interruptible and React
 * really does abandon it -- which kills an in-flight Server Action. For a read
 * that is merely wasteful; for a write it means the screen and the server
 * disagree about something the person believes they did, and the abandoned
 * request surfaces through the app-wide error boundary as "This page could not
 * be opened".
 *
 * These assert the SHAPE every converted mutation must keep: an explicit
 * pending flag, a handled result, a cleared flag on every path, and navigation
 * only after a confirmed success.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const flat = (path: string) => stripFormatting(readFileSync(path, "utf8"));

const CONVERTED = [
  "components/profile/profile-photo-carousel.tsx",
  "components/profile/profile-page.tsx",
  "components/linkr/linkr-page.tsx",
  "components/friends/friends-page.tsx"
] as const;

/** The startTransition sites that are allowed to remain, and why. */
const ALLOWED_READ_TRANSITIONS: Record<string, string[]> = {
  "components/linkr/linkr-page.tsx": ["loadLinkrCandidatesAction"],
  "components/friends/friends-page.tsx": ["searchUsersAction"]
};

describe("no mutation is left inside a transition", () => {
  for (const file of CONVERTED) {
    it(`${file.split("/").pop()} keeps only read transitions`, () => {
      const source = read(file);
      const allowed = ALLOWED_READ_TRANSITIONS[file] ?? [];

      // Every remaining transition body must be one of the known reads.
      const blocks: string[] = [];
      let index = source.indexOf("startTransition(async");
      while (index !== -1) {
        blocks.push(source.slice(index, index + 400));
        index = source.indexOf("startTransition(async", index + 1);
      }

      for (const block of blocks) {
        const isKnownRead = allowed.some((name) => block.includes(name));
        expect(isKnownRead, `unexpected transition:\n${block.slice(0, 160)}`).toBe(true);
      }
    });
  }
});

describe("every converted mutation owns an explicit pending flag", () => {
  it("the photo carousel reports visibility, reorder and delete", () => {
    const source = read("components/profile/profile-photo-carousel.tsx");
    expect(source).toContain("const [mutating, setMutating] = useState(false);");
    /* Count the CLEAR, not the `finally` around it. Counting blocks let a
     * mutation empty every finally body while the test still passed -- the
     * flag would never clear and the gallery would stay disabled forever. */
    const setsTrue = (source.match(/setMutating\(true\)/g) ?? []).length;
    const setsFalse = (source.match(/setMutating\(false\)/g) ?? []).length;
    expect(setsTrue).toBeGreaterThanOrEqual(3);
    // Every path that raises the flag must also lower it.
    expect(setsFalse).toBe(setsTrue);
    expect(source).toContain("const busy = uploading || mutating;");
  });

  it("profile save and avatar upload each have their own", () => {
    const source = read("components/profile/profile-page.tsx");
    expect(source).toContain("const [saving, setSaving] = useState(false);");
    expect(source).toContain("const [avatarUploading, setAvatarUploading] = useState(false);");
    // A dead flag is worse than none: the control would never disable.
    // A post-commit route transition is allowed; the mutation itself must not
    // be started inside an interruptible transition.
    expect(source).not.toContain("startTransition(async");
  });

  it("profile save clears its spinner after rejected requests and server errors", () => {
    const source = read("components/profile/profile-page.tsx");
    const save = source.slice(source.indexOf("function saveProfile"), source.indexOf("function selectAvatar"));
    expect(save).toContain("if (saving || returningToLinkr) return;");
    expect(save).toContain("try {");
    expect(save).toContain("} catch {");
    expect(save).toContain("} finally {");
    expect(save).toMatch(/finally\s*{\s*setSaving\(false\)/);
    expect(save).toContain("Your profile could not be saved. Check your connection and try again.");
  });

  it("avatar upload clears its spinner and preserves the selected file on failure", () => {
    const source = read("components/profile/profile-page.tsx");
    const upload = source.slice(source.indexOf("function saveAvatar"), source.indexOf("const ghostOn"));
    expect(upload).toContain("if (!selectedAvatarFile || avatarUploading || returningToLinkr) return;");
    expect(upload).toMatch(/finally\s*{\s*setAvatarUploading\(false\)/);
    const successAt = upload.indexOf("if (result.ok && result.avatarUrl) {");
    expect(successAt).toBeGreaterThan(-1);
    expect(upload.slice(0, successAt)).not.toContain("setSelectedAvatarFile(null)");
  });

  it("Linkr writes report through their own flag", () => {
    const source = read("components/linkr/linkr-page.tsx");
    expect(source).toContain("const [writing, setWriting] = useState(false);");
    expect(flat("components/linkr/linkr-page.tsx")).toContain("busy={pending || writing}");
  });

  it("Muddies writes report through their own flag", () => {
    const source = read("components/friends/friends-page.tsx");
    expect(source).toContain("const [writing, setWriting] = useState(false);");
    expect(source).toContain("const busy = isPending || writing;");
  });
});

describe("a refused mutation stays in context", () => {
  it("a refused profile save keeps the editor open", () => {
    /* setEditing(false) lives inside the success branch, so a rejected
     * username or an invalid date leaves every field exactly as typed. */
    const source = read("components/profile/profile-page.tsx");
    const save = source.slice(source.indexOf("const result = await updateProfileAction"));
    /* Bounded to the branch, and asserting the count: comparing indexOf
     * positions passed even when a SECOND setEditing(false) was added outside
     * the success branch, which is exactly the regression that matters. */
    /* Counting occurrences is the wrong instrument here: cancelEditing calls
     * setEditing(false) too, and legitimately. What must be true is that the
     * SAVE handler closes the editor only from inside its success branch --
     * so this checks the region BEFORE the branch, which is where a stray
     * unconditional close would have to live. */
    const successStart = save.indexOf("if (result.ok) {");
    const beforeBranch = save.slice(0, successStart);
    expect(successStart).toBeGreaterThan(-1);
    expect(beforeBranch).not.toContain("setEditing(false)");
    expect(save.slice(successStart, save.indexOf("})();"))).toContain("setEditing(false)");
  });

  it("a failed avatar upload keeps the chosen file for a retry", () => {
    const source = read("components/profile/profile-page.tsx");
    const upload = source.slice(source.indexOf("const result = await uploadAvatarAction"));
    /* Same reasoning: selectAvatar clears the file legitimately elsewhere, so
     * the property is that the UPLOAD handler clears it only after success --
     * nothing before the branch may discard the person's chosen photo. */
    const successAt = upload.indexOf("if (result.ok && result.avatarUrl) {");
    expect(successAt).toBeGreaterThan(-1);
    expect(upload.slice(0, successAt)).not.toContain("setSelectedAvatarFile(null)");
    expect(upload.slice(successAt, upload.indexOf("})();"))).toContain("setSelectedAvatarFile(null)");
  });

  it("a refused relationship change alters nothing locally", () => {
    const source = read("components/friends/friends-page.tsx");
    const funnel = source.slice(
      source.indexOf("function runFriendAction"),
      source.indexOf("function searchUsers")
    );
    const successAt = funnel.indexOf("if (result.ok) {");
    const localAt = funnel.indexOf("onLocalSuccess();");
    expect(successAt).toBeGreaterThan(-1);
    expect(localAt).toBeGreaterThan(successAt);
  });

  it("a refused Linkr preference rolls the UI back", () => {
    /* These are optimistic BY DESIGN -- the chip highlights at once -- so a
     * refusal has to restore the previous value rather than leave the screen
     * claiming a setting the server rejected. */
    const source = read("components/linkr/linkr-page.tsx");
    /* Assert the RESTORE, not the presence of a variable: keeping
     * `const previous = distance;` while dropping the restore left the chip
     * showing a preference the server had refused. */
    expect((source.match(/const previous = distance;/g) ?? []).length).toBe(2);
    expect((source.match(/discoveryDistance: previous/g) ?? []).length).toBe(2);
  });

  it("a permanent Pass only promises what the server recorded", () => {
    const source = read("components/linkr/linkr-page.tsx");
    expect(source).toContain('result.ok\n                      ? "You won\'t see them again."');
    expect(source).toContain("They may appear again.");
  });
});

describe("navigation happens only after a confirmed success", () => {
  it("a completed profile save returns to the preserved Linkr intent", () => {
    const source = read("components/profile/profile-page.tsx");
    const save = source.slice(source.indexOf("function saveProfile"), source.indexOf("function selectAvatar"));
    const successAt = save.indexOf("if (result.ok) {");
    const returnAt = save.indexOf("router.replace(returnTo as Route)");
    expect(successAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(successAt);
    expect(save.slice(successAt, returnAt)).toContain("nextProfile.dateOfBirth && avatarUrl");
  });

  it("opening a conversation navigates inside the ok branch", () => {
    const source = read("components/friends/friends-page.tsx");
    const open = source.slice(
      source.indexOf("const openConversationWith"),
      source.indexOf("function runFriendAction")
    );
    const okAt = open.indexOf("if (result.ok && result.conversationId)");
    const pushAt = open.indexOf("router.push(");
    expect(okAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(okAt);
  });

  it("the double-tap guard covers writes that are no longer transitions", () => {
    /* The guard read isPending, which stays false for a plain async write --
     * so it would have stopped guarding the very call it was written for. */
    const source = read("components/friends/friends-page.tsx");
    const open = source.slice(source.indexOf("const openConversationWith"));
    expect(open.slice(0, 700)).toContain("if (busy) return;");
  });
});

describe("profile actions isolate native avatar processing", () => {
  it("does not load Sharp while saving profile fields or DOB", () => {
    const actions = read("app/(app)/actions.ts");
    const beforeUpload = actions.slice(0, actions.indexOf("export async function uploadAvatarAction"));
    expect(beforeUpload).not.toContain("@/lib/media/processing");
    const upload = actions.slice(actions.indexOf("export async function uploadAvatarAction"));
    expect(upload).toContain('await import("@/lib/media/processing")');
  });

  it("traces Sharp and its Linux libvips runtime into production functions", () => {
    const config = read("next.config.ts");
    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("./node_modules/sharp/**/*");
    expect(config).toContain("./node_modules/@img/sharp-linux-x64/**/*");
    expect(config).toContain("./node_modules/@img/sharp-libvips-linux-x64/**/*");
  });

  it("returns an expected profile-save failure instead of throwing to the app error boundary", () => {
    const actions = read("app/(app)/actions.ts");
    const update = actions.slice(
      actions.indexOf("export async function updateProfileAction"),
      actions.indexOf("export async function uploadAvatarAction")
    );
    expect(update).toContain("try {");
    expect(update).toContain("} catch (error) {");
    expect(update).toContain("Your profile could not be saved. Please try again.");
  });
});
