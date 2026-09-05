import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { runOptimisticControlMutation } from "@/lib/messaging/optimistic-control";
import {
  markAwaitingConfirmation,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";

describe("the open conversation is a three-region shell", () => {
  it("keeps header and composer outside the sole message scroll owner", () => {
    const page = readFileSync("components/messages/messages-page-v4.tsx", "utf8");
    const pane = page.indexOf("data-chat-pane");
    const header = page.indexOf("data-chat-header", pane);
    const viewport = page.indexOf("data-message-scroll-owner", header);
    const composer = page.indexOf("<MessageComposerV4Shell", viewport);

    expect(pane).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(pane);
    expect(viewport).toBeGreaterThan(header);
    expect(composer).toBeGreaterThan(viewport);
    expect(page.slice(pane, header)).toContain("overflow-hidden");
    expect(page.slice(header, viewport)).toContain("shrink-0");
    expect(page.slice(viewport, composer)).toContain("min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain");

    const composerSource = readFileSync("components/messaging/message-composer-v4-shell.tsx", "utf8");
    expect(composerSource).toContain("data-chat-composer");
    expect(composerSource).toContain('className="relative shrink-0"');
  });
});

describe("settings are local-first", () => {
  it("opens its shell from known conversation data without awaiting a request", () => {
    const settings = readFileSync("components/messaging/chat-settings-v4.tsx", "utf8");
    expect(settings).toContain("<Modal");
    expect(settings).toContain("open={open}");
    expect(settings).toContain("conversation.title");
    expect(settings).toContain("<RowSkeleton");
    expect(settings).not.toContain("onRefresh");
  });

  it("applies immediately and retains the patch after success", async () => {
    const events: string[] = [];
    let finish!: (value: { ok: boolean; message: string }) => void;
    const pending = runOptimisticControlMutation({
      optimistic: () => events.push("optimistic"),
      rollback: () => events.push("rollback"),
      mutation: () => new Promise((resolve) => { finish = resolve; })
    });

    expect(events).toEqual(["optimistic"]);
    finish({ ok: true, message: "saved" });
    await expect(pending).resolves.toEqual({ ok: true, message: "saved" });
    expect(events).toEqual(["optimistic"]);
  });

  it("rolls back only after a definitive failure", async () => {
    const optimistic = vi.fn();
    const rollback = vi.fn();
    await expect(runOptimisticControlMutation({
      optimistic,
      rollback,
      mutation: async () => ({ ok: false, message: "denied" })
    })).resolves.toEqual({ ok: false, message: "denied" });
    expect(optimistic).toHaveBeenCalledBefore(rollback);
    expect(rollback).toHaveBeenCalledOnce();
  });
});

describe("ambiguous send timeouts stay truthful", () => {
  const pending: OptimisticMessage = {
    clientMessageId: "client-1",
    text: "hello",
    kind: "text",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending"
  };

  it("marks confirmation unknown without marking failure or success", () => {
    const [next] = markAwaitingConfirmation([pending], pending.clientMessageId);
    expect(next.status).toBe("pending");
    expect(next.confirmationState).toBe("unknown");
  });

  it("reconciles one canonical clientMessageId to one bubble", () => {
    const canonical = [{ clientMessageId: "client-1", createdAt: pending.createdAt }];
    expect(pruneConfirmed([markAwaitingConfirmation([pending], "client-1")[0]], canonical)).toEqual([]);
  });

  it("uses a bounded sender-scoped one-message lookup and no timeout banner", () => {
    const composer = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
    const mobile = readFileSync("lib/messaging/mobile.ts", "utf8");
    const page = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    expect(composer).not.toContain("Sending took too long");
    expect(composer).not.toContain("recording was kept");
    expect(composer).toContain('onOptimisticSettled?.(send.clientMessageId, "pending")');
    expect(composer).toContain('onOptimisticSettled?.(clientMessageId, "pending")');
    expect(mobile).toContain('.eq("sender_id", userId)');
    expect(mobile).toContain('.eq("client_message_id", options.clientMessageId)');
    expect(mobile).toContain('.limit(1)');
    expect(page).toContain("SEND_CONFIRMATION_DELAYS_MS = [2_000, 8_000, 30_000]");
    expect(page).toContain("getMessageByClientMessageIdAction(conversationId, clientMessageId)");
  });

  it("keeps prepared attachment and voice identities until canonical confirmation", () => {
    const composer = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
    const page = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    expect(composer).toContain("mediaId: send.mediaId");
    expect(composer).toContain("mediaId: prepared.mediaId");
    expect(composer).toContain("ambiguousVoiceIdRef.current = clientMessageId");
    expect(composer).toContain("confirmedClientMessageIds?.has(clientMessageId)");
    expect(page).toContain("mediaId: draft.mediaId, clientMessageId");
  });
});
