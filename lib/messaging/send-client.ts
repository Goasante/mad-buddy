"use client";

import { fetchWithTimeout } from "@/lib/network/resilience";

export type SendMessageClientResult = {
  ok: boolean;
  message: string;
  conversationId?: string;
  messageId?: string;
};

/**
 * Browser transport for the latency-sensitive send path.
 *
 * Messaging used to invoke a React/Next Server Action from the composer. That
 * means a send shares the Server Action transport with draft persistence,
 * typing/presence and other mutations on the same screen. A chat send is a
 * simple authenticated JSON mutation and already has a canonical API route,
 * so use that route directly instead: it can run independently, has a real
 * abort signal, and does not carry an RSC action response just to acknowledge
 * one message.
 */
export async function sendMessageViaApi(input: unknown): Promise<SendMessageClientResult> {
  const response = await fetchWithTimeout(
    "/api/messages/send",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    },
    15_000,
    "send message"
  );

  const payload = await response.json().catch(() => null) as SendMessageClientResult | null;
  if (payload && typeof payload.ok === "boolean" && typeof payload.message === "string") {
    return payload;
  }

  return {
    ok: false,
    message: response.ok ? "The message could not be confirmed." : "The message could not be sent."
  };
}
