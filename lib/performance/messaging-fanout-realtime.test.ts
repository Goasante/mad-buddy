import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const service = read("lib/messaging/service.ts");
const mobile = read("lib/messaging/mobile.ts");
const structured = read("app/(app)/messaging-structured-share-actions.ts");
const unread = read("hooks/use-unread-message-count.ts");
const deliveryAck = read("components/messages/message-delivery-ack.tsx");

describe("messaging fan-out and realtime hardening", () => {
  it("batches communication preferences for notification fan-out", () => {
    expect(service).toContain("export async function loadCommunicationPreferencesForUsers");
    expect(service).toContain('.in("user_id", uniqueIds)');

    expect(mobile).toContain("loadCommunicationPreferencesForUsers(");
    expect(mobile).not.toContain("loadCommunicationPreferences(admin, member.user_id)");

    expect(structured).toContain("loadCommunicationPreferencesForUsers(");
    expect(structured).not.toContain("loadCommunicationPreferences(admin, member.user_id)");
  });

  it("reuses one broad message INSERT stream instead of a second delivery channel", () => {
    expect((unread.match(/\.channel\(/g) ?? []).length).toBe(1);
    expect(unread).toContain('export const MESSAGE_INSERTED_EVENT = "mad-buddy:message-inserted"');
    expect(unread).toContain("if (record.sender_id === userId) return;");
    expect(unread).toContain("new CustomEvent(MESSAGE_INSERTED_EVENT");

    expect(deliveryAck).not.toContain("postgres_changes");
    expect(deliveryAck).not.toContain(".channel(");
    expect(deliveryAck).toContain("window.addEventListener(MESSAGE_INSERTED_EVENT, onIncomingMessage)");
    expect(deliveryAck).toContain("window.removeEventListener(MESSAGE_INSERTED_EVENT, onIncomingMessage)");
  });
});
