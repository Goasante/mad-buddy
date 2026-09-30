"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";
import { GroupsPageContent } from "@/components/groups/groups-page";
import { Modal } from "@/components/ui/modal";
import type { GroupsPageData } from "@/lib/groups/types";

export function GroupsManagerModal({
  open,
  createOnOpen = false,
  onOpenChange
}: {
  open: boolean;
  createOnOpen?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Groups" variant="sheet" owner="messages-groups-manager">
      {open ? <GroupsManagerContent createOnOpen={createOnOpen} onNavigate={() => onOpenChange(false)} /> : null}
    </Modal>
  );
}

// Each opening owns a fresh request and snapshot. Unmounting on close prevents
// stale data or an earlier failure from leaking into the next opening.
function GroupsManagerContent({ createOnOpen, onNavigate }: { createOnOpen: boolean; onNavigate: () => void }) {
  const [data, setData] = useState<GroupsPageData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadGroupsPageDataAction()
      .then((next) => {
        if (active) {
          setData(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, []);

  if (data) return <GroupsPageContent initialData={data} embedded initialCreateOpen={createOnOpen} onNavigate={onNavigate} />;
  if (failed) return <p className="py-8 text-center text-sm text-muted-foreground">Groups could not be loaded. Close this sheet and try again.</p>;
  return (
    <div className="grid min-h-40 place-items-center" role="status" aria-label="Loading Groups">
      <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
    </div>
  );
}
