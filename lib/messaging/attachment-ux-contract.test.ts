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

describe("chat attachment menu", () => {
  it("does not offer structured place sharing", () => {
    const picker = read("components/messaging/attachment-picker.tsx");
    expect(picker).not.toContain('id: "place"');
    expect(picker).not.toContain('setStructuredShareMode("place"');
    expect(picker).not.toContain("MapPin");
  });

  it("keeps Plan / Event structured sharing available", () => {
    const picker = read("components/messaging/attachment-picker.tsx");
    expect(picker).toContain('id: "agenda"');
    expect(picker).toContain('label: "Plan / Event"');
  });
});

describe("document identity and downloads", () => {
  it("persists and returns the original document name", () => {
    const upload = read("lib/media/chat-v4-rich-upload-service.ts");
    const projection = read("lib/messaging/rich-media-service.ts");
    expect(upload).toContain("original_file_name: fileName");
    expect(projection).toContain("asset.original_file_name");
    expect(projection).toContain("download: fileName");
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

  it("labels document tiles as DOC instead of the photo fallback", () => {
    const composer = read("components/messaging/message-composer-v3.tsx");
    expect(composer).toContain('{item.kind === "file" ? "DOC" : item.kind === "video" ? "Video" : "Photo"}');
    expect(composer).toContain('item.kind === "file" ? "document" : item.kind === "video" ? "video" : "photo"');
  });
});

describe("video attachment presentation", () => {
  it("keeps videos compact instead of stretching across the chat canvas", () => {
    const view = read("components/messaging/rich-media-message-v4.tsx");
    expect(view).toContain("w-[min(68vw,300px)]");
    expect(view).toContain("max-h-[320px]");
    expect(view).not.toContain("max-w-[440px]");
  });

  it("does not surface unreliable device filenames as the video title", () => {
    const view = read("components/messaging/rich-media-message-v4.tsx");
    const videoBlock = view.slice(view.indexOf('if (media.kind === "video")'), view.indexOf("return (\n    <div className=\"mb-2 min-w-0 max-w-full overflow-hidden\">"));
    expect(videoBlock).toContain('aria-label="Video attachment"');
    expect(videoBlock).toContain('>Video</span>');
    expect(videoBlock).not.toContain("{media.fileName}");
  });

  it("uses a neutral Video label while the upload is waiting in the composer", () => {
    const picker = read("components/messaging/attachment-picker.tsx");
    expect(picker).toContain('const displayName = kind === "video" ? "Video" : attachment?.fileName;');
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