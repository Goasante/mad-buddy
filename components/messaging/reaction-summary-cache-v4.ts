"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getConversationReactionSummariesAction } from "@/app/(app)/messaging-reaction-summary-action";
import type { MessageReactionSummaryMap } from "@/lib/messaging/reaction-summary-types";

type Entry = {
  data: MessageReactionSummaryMap;
  fetchedAt: number;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
};

const entries = new Map<string, Entry>();
const EMPTY_SUMMARY: MessageReactionSummaryMap = {};
const FRESH_MS = 2_500;
const POLL_MS = 5_000;

function entryFor(conversationId: string): Entry {
  let entry = entries.get(conversationId);
  if (!entry) {
    entry = { data: EMPTY_SUMMARY, fetchedAt: 0, inFlight: null, listeners: new Set(), timer: null };
    entries.set(conversationId, entry);
  }
  return entry;
}

async function load(conversationId: string, force = false) {
  const entry = entryFor(conversationId);
  if (!force && Date.now() - entry.fetchedAt < FRESH_MS) return;
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = (async () => {
    try {
      entry.data = await getConversationReactionSummariesAction(conversationId);
      entry.fetchedAt = Date.now();
      for (const listener of entry.listeners) listener();
    } catch {
      // Reactions are an enhancement. A temporary read failure must never
      // destabilise the message timeline or block sending.
    } finally {
      entry.inFlight = null;
    }
  })();
  return entry.inFlight;
}

function subscribe(conversationId: string, listener: () => void) {
  const entry = entryFor(conversationId);
  entry.listeners.add(listener);
  void load(conversationId);
  if (!entry.timer) {
    entry.timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(conversationId, true);
    }, POLL_MS);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  };
}

export function invalidateConversationReactionSummaries(conversationId: string) {
  const entry = entryFor(conversationId);
  entry.fetchedAt = 0;
  void load(conversationId, true);
}

export function useConversationReactionSummaries(conversationId: string) {
  const entry = entryFor(conversationId);
  const snapshot = useSyncExternalStore(
    (listener) => subscribe(conversationId, listener),
    () => entry.data,
    () => EMPTY_SUMMARY
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(conversationId, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [conversationId]);

  return snapshot;
}
