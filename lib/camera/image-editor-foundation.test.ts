import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const composer = read("components/camera/camera-composer.tsx");
const editor = read("components/camera/image-editor.tsx");
const renderer = read("lib/camera/image-renderer.ts");
const looks = read("lib/camera/mad-looks.ts");
const thumbnails = read("lib/camera/look-thumbnails.ts");

describe("Mad Cam C3/C4 image editor boundary", () => {
  it("lazy-loads editing after image review and keeps capture separate", () => {
    expect(composer).toContain('dynamic(() => import("@/components/camera/image-editor")');
    expect(composer).toContain('{ type: "edit_image" }');
    expect(editor).not.toContain("getUserMedia");
    expect(editor).not.toContain("MediaRecorder");
  });

  it("offers only implemented first-release tools", () => {
    for (const label of ["Looks", "Effects", "Crop", "Adjust", "Text", "Draw", "Undo", "Redo", "Reset to original"]) {
      expect(editor).toContain(label);
    }
    for (const future of ["Music", "Sticker", "AR effect", "Video editor"]) {
      expect(editor).not.toContain(future);
    }
  });

  it("keeps editing local with no upload, persistence or media asset creation", () => {
    const production = stripComments(`${editor}\n${renderer}\n${looks}\n${thumbnails}`).toLowerCase();
    for (const banned of ["supabase", "media_assets", "fetch(", "xmlhttprequest", "server action", "publishmoment", "sendmessage"]) {
      expect(production).not.toContain(banned);
    }
  });

  it("keeps one canonical renderer for live preview, thumbnails and export", () => {
    expect(editor).toContain("renderEditedImage(decoded, previewDocument");
    expect(renderer).toContain("renderEditedImage(decoded, editDocument");
    expect(thumbnails).toContain("renderEditedImage(decoded, document");
    expect(thumbnails).not.toContain("getContext(");
    expect(thumbnails).not.toContain("drawImage(");
  });

  it("exposes accessible Look selection, intensity and original comparison", () => {
    expect(editor).toContain('aria-label="Mad Looks"');
    expect(editor).toContain("aria-pressed={activeLook.id === look.id}");
    expect(editor).toContain('aria-valuetext={`${session.present.look.intensity} percent`}');
    expect(editor).toContain('aria-label="Hold to compare original"');
    expect(editor).toContain("documentForOriginalComparison(session.present)");
  });

  it("has accessible controls, touch editing and reduced-motion behavior", () => {
    expect(editor).toContain('aria-label="Photo editor"');
    expect(editor).toContain('aria-label="Close editor"');
    expect(editor).toContain('aria-label="Edited photo preview"');
    expect(editor).toContain("onPointerDown");
    expect(editor).toContain("motion-reduce:animate-none");
    expect(read("app/globals.css")).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
