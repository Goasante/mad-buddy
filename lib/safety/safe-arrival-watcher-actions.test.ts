import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("components/safety/safe-arrival-page.tsx", "utf8");

describe("Safe Arrival watcher actions", () => {
  it("shows the check-in message action from the visible overdue state, not only canonical unconfirmed status", () => {
    expect(page).toContain('tone === "overdue" && journey.myAcknowledgement === "accepted"');
    expect(page).not.toContain('journey.status === "unconfirmed" && journey.myAcknowledgement === "accepted"');
    expect(page).toContain('messagePending ? "Opening chat…" : `Message ${firstName}`');
  });

  it("gives feedback if opening the traveller chat fails", () => {
    expect(page).toContain("Couldn’t open the chat. Try again, or open Messages from the bottom bar.");
    expect(page).toContain('role="alert"');
    expect(page).toContain('messagePending ? "Opening chat…"');
  });
});
