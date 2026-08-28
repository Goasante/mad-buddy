"use client";

import { Bookmark, FolderPlus, Loader2, Pin, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  createSavedMessageFolderAction,
  deleteSavedMessageFolderAction,
  getChatCollectionsAction,
  moveSavedMessageToFolderAction
} from "@/app/(app)/messaging-v4-insights-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { ChatCollectionsView } from "@/lib/messaging/v4-insights-types";
import { cn } from "@/lib/utils";

type Tab = "saved" | "pinned";

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function ChatCollectionsV4({
  conversationId,
  open,
  onOpenChange,
  initialTab = "saved",
  onFeedback
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: Tab;
  onFeedback: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<ChatCollectionsView>({ folders: [], saved: [], pinned: [] });
  const [loading, setLoading] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | "all" | "unfiled">("all");
  const [isPending, startTransition] = useTransition();

  async function refresh(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      setData(await getChatCollectionsAction(conversationId));
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void getChatCollectionsAction(conversationId).then((next) => {
      if (disposed) return;
      setData(next);
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [conversationId, open]);

  const visibleSaved = useMemo(() => {
    if (folderFilter === "all") return data.saved;
    if (folderFilter === "unfiled") return data.saved.filter((item) => !item.folderId);
    return data.saved.filter((item) => item.folderId === folderFilter);
  }, [data.saved, folderFilter]);

  function jump(messageId: string) {
    onOpenChange(false);
    requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (node) {
        node.animate?.(
          [
            { backgroundColor: "rgba(232,140,43,0)" },
            { backgroundColor: "rgba(232,140,43,.14)" },
            { backgroundColor: "rgba(232,140,43,0)" }
          ],
          { duration: 1100, easing: "ease-out" }
        );
      }
    });
  }

  function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createSavedMessageFolderAction(name);
      onFeedback(result.message);
      if (result.ok) {
        setFolderName("");
        await refresh();
      }
    });
  }

  function deleteFolder(folderId: string) {
    startTransition(async () => {
      const result = await deleteSavedMessageFolderAction(folderId);
      onFeedback(result.message);
      if (result.ok) {
        if (folderFilter === folderId) setFolderFilter("all");
        await refresh();
      }
    });
  }

  function move(messageId: string, folderId: string | null) {
    startTransition(async () => {
      const result = await moveSavedMessageToFolderAction(messageId, folderId);
      onFeedback(result.message);
      if (result.ok) await refresh();
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Chat collections" variant="sheet">
      <div className="space-y-4 pb-[max(.5rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary/55 p-1" role="tablist" aria-label="Chat collections">
          <button type="button" role="tab" aria-selected={tab === "saved"} onClick={() => setTab("saved")} className={cn("focus-ring min-h-10 rounded-xl text-xs font-bold transition", tab === "saved" ? "bg-card text-[#4E0401] shadow-sm dark:text-orange-100" : "text-muted-foreground")}><Bookmark className="mr-1.5 inline h-3.5 w-3.5" />Saved · {data.saved.length}</button>
          <button type="button" role="tab" aria-selected={tab === "pinned"} onClick={() => setTab("pinned")} className={cn("focus-ring min-h-10 rounded-xl text-xs font-bold transition", tab === "pinned" ? "bg-card text-[#4E0401] shadow-sm dark:text-orange-100" : "text-muted-foreground")}><Pin className="mr-1.5 inline h-3.5 w-3.5" />Pinned · {data.pinned.length}</button>
        </div>

        {loading ? (
          <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#E88C2B] motion-reduce:animate-none" /></div>
        ) : tab === "saved" ? (
          <>
            <section className="rounded-[22px] border border-border/60 bg-card/60 p-3">
              <div className="flex gap-2">
                <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createFolder(); }} placeholder="New Saved folder" maxLength={60} />
                <Button type="button" size="sm" onClick={createFolder} disabled={isPending || !folderName.trim()} aria-label="Create Saved folder"><FolderPlus className="h-4 w-4" /></Button>
              </div>
              <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
                <FilterChip active={folderFilter === "all"} onClick={() => setFolderFilter("all")}>All</FilterChip>
                <FilterChip active={folderFilter === "unfiled"} onClick={() => setFolderFilter("unfiled")}>Unfiled</FilterChip>
                {data.folders.map((folder) => (
                  <div key={folder.id} className="inline-flex shrink-0 items-center rounded-full border border-border/65 bg-background">
                    <button type="button" onClick={() => setFolderFilter(folder.id)} className={cn("focus-ring min-h-9 rounded-l-full px-3 text-[11px] font-semibold", folderFilter === folder.id && "bg-[#E88C2B] text-white")}>{folder.name}</button>
                    <button type="button" onClick={() => deleteFolder(folder.id)} disabled={isPending} className="focus-ring grid h-9 w-9 place-items-center rounded-r-full text-muted-foreground hover:text-destructive" aria-label={`Delete ${folder.name} folder`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </section>

            {visibleSaved.length === 0 ? (
              <EmptyCollection icon={Bookmark} title="Nothing Saved here" description="Long-press a message and choose Save. Saved messages are private to you." />
            ) : (
              <ul className="space-y-2">
                {visibleSaved.map((item) => (
                  <li key={item.messageId} className="rounded-[20px] border border-border/60 bg-card/60 p-3">
                    <button type="button" onClick={() => jump(item.messageId)} className="focus-ring block w-full text-left">
                      <div className="flex items-start gap-2"><Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-[#E88C2B]" /><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.senderName}</strong><p className="mt-1 line-clamp-2 text-sm leading-relaxed">{item.preview}</p><span className="mt-1 block text-[10px] text-muted-foreground">{when(item.createdAt)}</span></div></div>
                    </button>
                    <div className="mt-2 border-t border-border/45 pt-2">
                      <label className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
                        Folder
                        <select value={item.folderId ?? ""} disabled={isPending} onChange={(event) => move(item.messageId, event.target.value || null)} className="focus-ring min-h-9 max-w-[65%] rounded-xl border border-border/70 bg-background px-2 text-xs text-foreground">
                          <option value="">Unfiled</option>
                          {data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                        </select>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : data.pinned.length === 0 ? (
          <EmptyCollection icon={Pin} title="No pinned messages" description="Pinned messages become a shared navigation layer for this conversation." />
        ) : (
          <ul className="space-y-2">
            {data.pinned.map((item, index) => (
              <li key={item.messageId}>
                <button type="button" onClick={() => jump(item.messageId)} className="focus-ring flex w-full items-start gap-3 rounded-[20px] border border-border/60 bg-card/60 p-3 text-left transition hover:border-[#E88C2B]/30 active:scale-[.99]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E88C2B]/10 text-[11px] font-bold text-[#E88C2B]">{index + 1}</span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.senderName}</strong><span className="mt-1 block line-clamp-2 text-sm leading-relaxed">{item.preview}</span><span className="mt-1 block text-[10px] text-muted-foreground">Pinned {item.pinnedAt ? when(item.pinnedAt) : ""}</span></span>
                  <Pin className="h-4 w-4 shrink-0 fill-[#E88C2B] text-[#E88C2B]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("focus-ring min-h-9 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition", active ? "border-[#E88C2B] bg-[#E88C2B] text-white" : "border-border/70 bg-background")}>{children}</button>;
}

function EmptyCollection({ icon: Icon, title, description }: { icon: typeof Bookmark; title: string; description: string }) {
  return <div className="grid min-h-44 place-items-center rounded-[22px] border border-dashed border-border/70 bg-card/35 px-6 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#E88C2B]/10 text-[#E88C2B]"><Icon className="h-5 w-5" /></span><strong className="mt-3 block text-sm">{title}</strong><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p></div></div>;
}
