import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Listening to your own recording is not sending it (spec R2 §3, §20, §21).
 *
 * Playback and submission must be architecturally independent: Play, Pause and
 * Replay on a local preview perform ZERO mutations -- no send, no upload, no
 * conversation write. Driving the running app proved this holds today (the
 * Play phase recorded no requests at all), so these tests exist to keep it
 * true rather than to fix it.
 *
 * Source-level assertions, deliberately. The failure mode this guards is
 * structural -- a playback control acquiring a submit type, or a send call
 * migrating into the play handler -- and structure is exactly what a source
 * assertion can hold still. They complement the browser run; they do not
 * replace it.
 */

const composerSource = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
const composer = stripComments(composerSource);

/** The JSX of one control, from its opening tag to the end of that element. */
function controlFor(label: string): string {
  const marker = `aria-label={playing ? "Pause voice message" : "Play voice message"}`;
  const anchor = label === "play" ? marker : `aria-label="${label}"`;
  const at = composer.indexOf(anchor);
  expect(at, `control ${label} not found`).toBeGreaterThan(-1);
  // Walk back to the <button that owns this attribute, then forward past it.
  const open = composer.lastIndexOf("<button", at);
  return composer.slice(open, composer.indexOf("</button>", at));
}

describe("the play control cannot send", () => {
  const play = controlFor("play");

  it("is a button, never a submit", () => {
    // A <button> inside a form defaults to type="submit". That default is the
    // single likeliest way a play tap becomes a message.
    expect(play).toContain('type="button"');
  });

  it("calls no send, upload or action from its handler", () => {
    for (const forbidden of ["sendVoice", "sendMessageAction", "voiceUpload.upload", "startTransition"]) {
      expect(play, `play handler must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does nothing but drive the audio element", () => {
    // play/pause on the element and the local `playing` flag, and no more.
    expect(play).toContain("audio.play()");
    expect(play).toContain("audio.pause()");
  });
});

describe("every non-submit composer control declares its type", () => {
  /**
   * Any button that is NOT the deliberate send action must say type="button".
   * Record, stop, delete, play, emoji and attachment all live in or beside the
   * composer form, and a missing type on any of them submits it.
   */
  it("leaves no button without an explicit type", () => {
    const buttons = composer.split("<button").slice(1);
    const untyped = buttons.filter((b) => {
      const tag = b.slice(0, b.indexOf(">"));
      return !tag.includes("type=");
    });
    expect(untyped, `${untyped.length} <button> without an explicit type`).toHaveLength(0);
  });

  it("has exactly one submit control", () => {
    // Exactly one intentional send. More than one means something else in the
    // composer can post a message.
    const submits = composer.match(/type="submit"/g) ?? [];
    expect(submits).toHaveLength(1);
  });
});

describe("the recording survives being listened to", () => {
  it("does not revoke the preview URL when playback merely pauses", () => {
    const play = controlFor("play");
    expect(play).not.toContain("revokeObjectURL");
    expect(play).not.toContain("voice.cancel");
  });

  it("keeps the take until the send succeeds or the person discards it", () => {
    // voice.cancel() is what drops the blob. It may only be reached from the
    // success path or from an explicit discard -- never from playback.
    const send = composer.slice(composer.indexOf("const sendVoice"));
    const okBranch = send.slice(send.indexOf('onOptimisticSettled?.(clientMessageId, "sent")'));
    expect(okBranch).toContain("voice.cancel()");
  });

  it("keeps the recording available after a failed send", () => {
    // The catch block reports and stops. If it cancelled, a network blip would
    // cost the person the thing they just said.
    const send = composer.slice(composer.indexOf("const sendVoice"));
    const katch = send.slice(send.indexOf("} catch (error) {"), send.indexOf("} catch (error) {") + 700);
    expect(katch).not.toContain("voice.cancel");
    expect(katch).not.toContain("voiceUpload.reset");
  });
});

describe("a playback failure is not reported as a send failure", () => {
  it("keeps the two messages distinct", () => {
    // Different product states must not share wording, or the person is told
    // their message failed when only the speaker did.
    expect(composer).toContain("That recording could not be played back.");
    expect(composer).toContain("Couldn't send that voice message. Try again.");
  });

  it("reports the playback message from the audio element, not the send path", () => {
    // V3 surfaces a failed decode from the audio element's own play() rejection
    // rather than an onError prop. Same boundary: the message originates at the
    // element, never in the send path.
    const play = composer.slice(composer.indexOf("if (audio.paused) {"));
    expect(play.slice(0, 420)).toContain("could not be played back");
  });
});
