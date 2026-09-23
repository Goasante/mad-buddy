"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";
import { GroupsPageContent } from "@/components/groups/groups-page";
import { Modal } from "@/components/ui/modal";
import type { GroupsPageData } from "@/lib/groups/types";

export function GroupsManagerModal({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<GroupsPageData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setData(null);
    setFailed(false);

    void loadGroupsPageDataAction()
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Groups" variant="sheet" owner="messages-groups-manager">
      {data ? (
        <GroupsPageContent initialData={data} embedded onNavigate={() => onOpenChange(false)} />
      ) : failed ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Groups could not be loaded. Close this sheet and try again.</p>
      ) : (
        <div className="grid min-h-40 place-items-center" role="status" aria-label="Loading Groups">
          <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      )}
    </Modal>
  );
}
