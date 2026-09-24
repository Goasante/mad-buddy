"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getConversationReactionSummariesAction } from "@/app/(app)/messaging-reaction-summary-action";
import type { MessageReactionSummaryMap, ReactionAggregate } from "@/lib/messaging/reaction-summary-types";

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

/**
 * Paint the viewer's reaction immediately while the server mutation is in
 * flight. The returned rollback restores the exact prior cache snapshot if
 * the request fails. Reactor identities are deliberately left for the
 * authoritative refresh; only the count visible below the bubble is changed.
 */
export function optimisticallySetMessageReaction(input: {
  conversationId: string;
  messageId: string;
  previousReaction: string | null;
  nextReaction: string | null;
}) {
  const entry = entryFor(input.conversationId);
  const previousData = entry.data;
  const current = [...(previousData[input.messageId] ?? [])];

  function changeCount(reaction: string, delta: number) {
    const index = current.findIndex((aggregate) => aggregate.reaction === reaction);
    if (index < 0) {
      if (delta > 0) {
        current.push({ reaction: reaction as ReactionAggregate["reaction"], count: delta, reactors: [] });
      }
      return;
    }
    const nextCount = Math.max(0, current[index].count + delta);
    if (nextCount === 0) current.splice(index, 1);
    else current[index] = { ...current[index], count: nextCount };
  }

  if (input.previousReaction) changeCount(input.previousReaction, -1);
  if (input.nextReaction) changeCount(input.nextReaction, 1);
  entry.data = { ...previousData, [input.messageId]: current };
  for (const listener of entry.listeners) listener();

  return () => {
    entry.data = previousData;
    for (const listener of entry.listeners) listener();
  };
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
