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
 *
 * MESSAGING V5. The canonical composer converged on V3, which closes this by
 * OWNERSHIP rather than by a teardown flag: V3 never revokes the preview URL.
 * It only ever reads `take.objectUrl`, and the recording controller is the sole
 * owner of that URL's lifetime. With one owner there is no window in which a
 * live element is pointed at a revoked URL, so the false decode error the
 * original guards suppressed cannot be produced here.
 *
 * These assertions therefore hold the same invariant against the architecture
 * that now implements it. They are not relaxed: single-ownership is a STRONGER
 * guarantee than suppressing the error after the fact.
 */

const composer = stripComments(readFileSync("components/messaging/message-composer-v3.tsx", "utf8"));
const controller = stripComments(readFileSync("lib/messaging/voice-recording.ts", "utf8"));

describe("teardown cannot be mistaken for a decode failure", () => {
  it("keeps a single owner for the preview URL -- the composer never revokes it", () => {
    // Two owners revoking is how a preview dies while still on screen.
    expect(composer).not.toContain("revokeObjectURL");
  });

  it("reads the take's URL rather than minting a second one", () => {
    // A second createObjectURL would reintroduce two lifetimes for one take.
    expect(composer).toContain("src={take.objectUrl}");
    expect(composer).not.toContain("createObjectURL");
  });

  it("still reports a genuine playback failure", () => {
    // Owning the URL correctly must not trade a false alarm for a missing one:
    // a real decode failure still has to reach the person.
    expect(composer).toContain("That recording could not be played back.");
  });

  it("reports that failure from the audio element, not from the send path", () => {
    const play = composer.slice(composer.indexOf("if (audio.paused) {"));
    expect(play.slice(0, 420)).toContain(".catch(");
    expect(play.slice(0, 420)).toContain("could not be played back");
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
    const afterOk = send.slice(send.indexOf('onOptimisticSettled?.(clientMessageId, "sent")'));
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

  it("clears a stale playback error when a send starts", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    expect(send.slice(0, 900)).toContain('onFeedback("")');
  });

  it("keeps the recording when a send fails, so nothing spoken is lost", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    const failure = send.slice(send.indexOf("if (!result.ok) {"));
    expect(failure.slice(0, 200)).toContain("return;");
    expect(failure.slice(0, 200)).not.toContain("voice.cancel()");
  });

  it("guards against a double tap creating two messages", () => {
    const send = composer.slice(composer.indexOf("const sendVoice = useCallback"));
    expect(send.slice(0, 300)).toContain("if (sendingRef.current) return;");
    expect(send.slice(0, 300)).toContain("sendingRef.current = true;");
  });
});
