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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [group, messages] = await Promise.all([
      loadGroupDetailAction(conversationId),
      getMessagesAction(conversationId)
    ]);
    if (!group) throw new Error("group_not_available");
    setLoaded({ group, messages });
    setFailed(false);
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    void Promise.all([
      loadGroupDetailAction(conversationId),
      getMessagesAction(conversationId)
    ])
      .then(([group, messages]) => {
        if (!active) return;
        if (!group) {
          setFailed(true);
          return;
        }
        setLoaded({ group, messages });
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
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
          embedded
          onRefresh={() => void load().catch(() => setFailed(true))}
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
