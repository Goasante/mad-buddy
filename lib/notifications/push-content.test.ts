import { describe, expect, it } from "vitest";
import { privacySafePushPayload } from "@/lib/notifications/push-content";

const ID = "3f8c1e2a-0000-4000-8000-000000000000";

describe("privacy-safe push payloads", () => {
  it("does not expose message content", () => {
    const payload = privacySafePushPayload({
      type: `message:${ID}`,
      title: "Kofi",
      message: "Meet me at the private address at 7"
    });
    expect(payload).toEqual({
      title: "Mad Buddy",
      body: "You have a new Mad Buddy message.",
      url: `/messages?conversation=${ID}`
    });
  });

  it("does not expose Safe Arrival destinations or coordinates", () => {
    const payload = privacySafePushPayload({
      type: `safe_arrival:${ID}`,
      title: "Safe Arrival request",
      message: "Heading to a private destination at 5.6037,-0.1870"
    });
    expect(payload.body).toBe("There is an update to a Safe Arrival session.");
    expect(JSON.stringify(payload)).not.toMatch(/5\.6037|-0\.1870|private destination/i);
  });

  it("does not expose group message content", () => {
    expect(
      privacySafePushPayload({
        type: `group_message:${ID}`,
        title: "Weekend Crew",
        message: "Private group message"
      })
    ).toEqual({
      title: "Mad Buddy",
      body: "You have a new Mad Buddy group message.",
      url: `/groups/${ID}`
    });
  });

  it("keeps concise non-sensitive achievement copy", () => {
    expect(
      privacySafePushPayload({
        type: "achievement:first_wave",
        title: "First wave",
        message: "You sent your first wave."
      })
    ).toMatchObject({
      title: "First wave",
      body: "You sent your first wave.",
      url: "/badges?achievement=first_wave"
    });
  });

  it("never adds credentials to a destination", () => {
    const serialized = JSON.stringify(
      privacySafePushPayload({
        type: "message:https://evil.example/?access_token=secret",
        title: "Private",
        message: "refresh_token=secret"
      })
    );
    expect(serialized).not.toMatch(/access_token|refresh_token|secret/i);
  });
});
