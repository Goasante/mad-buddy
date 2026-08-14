import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * A recording must play locally as reliably as it plays after sending.
 *
 * THE REPORTED DEFECT. Record, stop, and the preview reported "That recording
 * could not be played back on this device." Send the same recording and it
 * played perfectly. The recording was never the problem.
 *
 * ROOT CAUSE. Sending (and discarding) calls voice.cancel(), which revokes the
 * preview's object URL. The <audio> element was still mounted with src set to
 * that URL, and revoking a URL out from under a live media element makes the
 * browser fire an `error` event. That reached onError, which reported a decode
 * failure -- so the message appeared at the moment the send SUCCEEDED,
 * describing a failure that never happened.
 */

const composer = stripComments(readFileSync("components/messaging/message-composer.tsx", "utf8"));
const controller = stripComments(readFileSync("lib/messaging/voice-recording.ts", "utf8"));

describe("teardown is not mistaken for a decode failure", () => {
  it("marks a deliberate teardown before the URL is revoked", () => {
    expect(composer).toContain("tearingDownPreviewRef");
  });

  it("suppresses the playback error during that teardown", () => {
    const onError = composer.slice(composer.indexOf("onError={() => {"));
    expect(onError.slice(0, 260)).toContain("if (tearingDownPreviewRef.current) return;");
  });

  it("still reports a genuine decode failure", () => {
    // Suppressing every error would trade a false alarm for a missing one.
    expect(composer).toContain("That recording could not be played back on this device.");
  });

  it("re-arms error reporting when a new take arrives", () => {
    // Otherwise the flag would stay true after the first send and a genuinely
    // undecodable later recording would fail silently.
    expect(composer).toContain("tearingDownPreviewRef.current = false");
  });
});

describe("the element lets go of the URL before it dies", () => {
  it("detaches src and reloads the element on teardown", () => {
    const release = composer.slice(composer.indexOf("const releasePreviewElement"));
    expect(release.slice(0, 420)).toContain('removeAttribute("src")');
    expect(release.slice(0, 420)).toContain("audio.load()");
  });

  it("uses that same release on both send and discard", () => {
    // Two teardown paths, one ordering. Discarding hit the identical bug.
    const occurrences = composer.split("releasePreviewElement()").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("does not revoke the URL itself -- the controller owns it", () => {
    // Two owners revoking is how a preview dies while still on screen.
    expect(composer).not.toContain("revokeObjectURL");
  });
});

describe("the controller keeps one URL per take", () => {
  it("revokes the previous preview before creating a new one", () => {
    const finalize = controller.slice(controller.indexOf("this.revokePreview();"));
    expect(finalize.slice(0, 200)).toContain("this.objectUrl = this.runtime.createObjectURL(blob)");
  });

  it("revokes only through one helper, so lifetime has a single owner", () => {
    expect(controller).toContain("private revokePreview()");
  });
});

describe("sending clears the review state at the success boundary", () => {
  it("stops playback the moment sending begins", () => {
    // The take is deliberately kept until the server confirms, but playback and
    // its moving progress belong to reviewing, not to sending.
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    expect(send.slice(0, 900)).toContain("audioRef.current?.pause()");
  });

  it("clears the recorder state after the server confirms, not on a timer", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    const afterOk = send.slice(send.indexOf("clientMessageIdRef.current = null;"));
    expect(afterOk).toContain("voice.cancel()");
    expect(afterOk).toContain("voiceUpload.reset()");
  });

  it("does not hide the recorder with an arbitrary timeout", () => {
    const send = composer.slice(
      composer.indexOf("const sendVoice = useCallback"),
      composer.indexOf("useEffect(() => {", composer.indexOf("const sendVoice = useCallback"))
    );
    expect(send).not.toContain("setTimeout");
  });

  it("clears a stale playback error when a send starts and when it succeeds", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    expect(send).toContain('onFeedback("")');
  });

  it("keeps the recording when a send fails, so nothing spoken is lost", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    const failure = send.slice(send.indexOf("if (!result.ok) {"));
    expect(failure.slice(0, 160)).toContain("return;");
    expect(failure.slice(0, 160)).not.toContain("voice.cancel()");
  });
});
