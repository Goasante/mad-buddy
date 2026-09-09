import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("event QR handoff", () => {
  it("encodes an app scan URL rather than an opaque token", () => {
    const panel = read("components/events/event-qr.tsx");
    expect(panel).toContain('new URL("/scan", window.location.origin)');
    expect(panel).toContain('destination.searchParams.set("c", result.token)');
    expect(panel).toContain("toDataURL(encodedValue");
  });

  it("keeps the scanner able to extract URL-wrapped codes", () => {
    const scanner = read("components/scan/scan-page.tsx");
    expect(scanner).toContain('url.searchParams.get("c")');
    expect(scanner).toContain('params.get("c")');
  });
});

describe("document identity and downloads", () => {
  it("persists and returns the original document name", () => {
    const service = read("lib/media/chat-v4-rich-upload-service.ts");
    const action = read("app/(app)/messaging-rich-media-actions.ts");
    expect(service).toContain("original_file_name: fileName");
    expect(action).toContain("asset.original_file_name");
    expect(action).toContain("download: fileName");
  });

  it("uses the provider filename-preserving URL for Save", () => {
    const view = read("components/messaging/rich-media-message-v4.tsx");
    expect(view).toContain("media.downloadUrl ?? media.url");
    expect(view).toContain("{media.fileName}");
  });

  it("keeps long document names inside a bounded chat card", () => {
    const view = read("components/messaging/rich-media-message-v4.tsx");
    expect(view).toContain("w-[min(78vw,360px)]");
    expect(view).toContain('className="block max-w-full truncate text-xs"');
    expect(view).toContain("title={media.fileName}");
  });
});

describe("visible upload progress", () => {
  it("is based on browser upload bytes and not a timer", () => {
    const uploader = read("lib/media/signed-upload-progress.ts");
    expect(uploader).toContain('xhr.upload.addEventListener("progress"');
    expect(uploader).toContain("event.loaded");
    expect(uploader).toContain("event.total");
    expect(uploader).not.toContain("setInterval");
  });

  it("renders the measured percentage in the composer control", () => {
    const picker = read("components/messaging/attachment-picker.tsx");
    expect(picker).toContain("UploadProgressGlyph");
    expect(picker).toContain("progress.percent");
    expect(picker).toContain("percent`");
  });

  it("keeps remove actions specific to the attachment kind", () => {
    const picker = read("components/messaging/attachment-picker.tsx");
    expect(picker).toContain('"Remove document"');
    expect(picker).toContain('"Remove video"');
    expect(picker).toContain('"Remove photo"');
  });
});

describe("mobile bottom safe-area convergence", () => {
  it("absorbs the safe-area allowance inside one fixed navigation footprint", () => {
    const css = read("app/mobile-shell-stability.css");
    const layout = read("app/layout.tsx");
    expect(layout).toContain('import "./mobile-shell-stability.css"');
    expect(css).toContain('nav[aria-label="Mobile navigation"]');
    expect(css).toContain("height: var(--mobile-nav-height)");
    expect(css).toContain("--mobile-nav-safe-bottom: min(env(safe-area-inset-bottom, 0px), 0.75rem)");
    expect(css).toContain("padding-bottom: var(--mobile-nav-safe-bottom) !important");
    expect(css).toContain("padding-top: max(0.25rem, calc(1rem - var(--mobile-nav-safe-bottom))) !important");
    expect(css).not.toContain("padding-bottom: env(safe-area-inset-bottom, 0px) !important");
  });
});
