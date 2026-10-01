"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { loadGroupDetailAction } from "@/app/(app)/group-actions";
import { getMessagesAction } from "@/app/(app)/messaging-actions";
import { GroupDetailPageV2 } from "@/components/groups/group-detail-page-v2";
import { Modal } from "@/components/ui/modal";
import type { GroupDetailView } from "@/lib/groups/types";
import type { ChatMessageView } from "@/lib/messaging/mobile";

type LoadedGroup = {
  group: GroupDetailView;
  messages: ChatMessageView[];
};

export function GroupDetailsModal({
  conversationId,
  open,
  onOpenChange,
  onExited
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExited?: () => void;
}) {
  const [loaded, setLoaded] = useState<LoadedGroup | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [messagesLoadingFor, setMessagesLoadingFor] = useState<string | null>(null);
  const [messagesLoadedFor, setMessagesLoadedFor] = useState<string | null>(null);

  const failed = failedFor === conversationId;
  const messagesLoading = messagesLoadingFor === conversationId;
  const messagesLoaded = messagesLoadedFor === conversationId;

  const load = useCallback(async () => {
    const group = await loadGroupDetailAction(conversationId);
    if (!group) throw new Error("group_not_available");
    setLoaded((current) => ({
      group,
      messages: current?.group.id === conversationId ? current.messages : []
    }));
    setFailedFor(null);
  }, [conversationId]);

  const loadMessages = useCallback(async () => {
    if (messagesLoading || messagesLoaded) return;
    setMessagesLoadingFor(conversationId);
    try {
      const messages = await getMessagesAction(conversationId);
      setLoaded((current) =>
        current?.group.id === conversationId ? { ...current, messages } : current
      );
      setMessagesLoadedFor(conversationId);
    } finally {
      setMessagesLoadingFor((current) => current === conversationId ? null : current);
    }
  }, [conversationId, messagesLoaded, messagesLoading]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    void loadGroupDetailAction(conversationId)
      .then((group) => {
        if (!active) return;
        if (!group) {
          setFailedFor(conversationId);
          return;
        }
        setLoaded({ group, messages: [] });
        setFailedFor(null);
      })
      .catch(() => {
        if (active) setFailedFor(conversationId);
      });

    return () => {
      active = false;
    };
  }, [conversationId, open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Group details" variant="sheet" owner="messages-group-details">
      {loaded?.group.id === conversationId ? (
        <GroupDetailPageV2
          group={loaded.group}
          initialMessages={loaded.messages}
          messagesLoading={messagesLoading}
          messagesLoaded={messagesLoaded}
          onLoadMessages={() => void loadMessages()}
          embedded
          onRefresh={() => void load().catch(() => setFailedFor(conversationId))}
          onExit={() => {
            onOpenChange(false);
            onExited?.();
          }}
        />
      ) : failed ? (
        <p className="py-8 text-center text-sm text-muted-foreground">This Group is not available.</p>
      ) : (
        <div className="grid min-h-40 place-items-center" role="status" aria-label="Loading Group details">
          <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      )}
    </Modal>
  );
}
