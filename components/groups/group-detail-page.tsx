"use client";

import Link from "next/link";
import { ChevronLeft, FileText, Send, Users2, Vote } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PreviewNotice } from "@/components/ui/preview-notice";
import type { GroupItem } from "@/components/groups/groups-page";

type GroupTab = "chat" | "plans" | "polls" | "members" | "files";

type GroupMessage = { id: string; from: "me" | string; text: string; time: string };

const groupTabs: Array<{ id: GroupTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "plans", label: "Plans" },
  { id: "polls", label: "Polls" },
  { id: "members", label: "Members" },
  { id: "files", label: "Files" }
];

const seedMembers = ["Kojo Mensah", "Ama Serwaa", "Sena Quayson", "Efua Yeboah"];

const seedMessages: GroupMessage[] = [
  { id: "g1", from: "Kojo Mensah", text: "Team, check out this potential collab opportunity.", time: "10:21 AM" },
  { id: "g2", from: "Ama Serwaa", text: "Looks good! Let's discuss this weekend.", time: "10:23 AM" }
];

export function GroupDetailPage({ group }: { group: GroupItem }) {
  const [tab, setTab] = useState<GroupTab>("chat");
  const [messages, setMessages] = useState<GroupMessage[]>(seedMessages);
  const [draft, setDraft] = useState("");

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: `g-${Date.now()}`, from: "me", text, time: "Just now" }]);
    setDraft("");
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <Link href="/groups" className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Groups
      </Link>

      <PreviewNotice />

      <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card/50 p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Users2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">{group.memberCount} members</p>
        </div>
      </div>

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Group tabs">
        <div className="flex min-w-max gap-1">
          {groupTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === "chat" ? (
        <div className="flex h-[55vh] flex-col rounded-2xl border border-border/70">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.from === "me" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-6",
                    message.from === "me" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                  )}
                >
                  {message.from !== "me" ? <p className="mb-0.5 text-xs font-semibold opacity-80">{message.from}</p> : null}
                  <p>{message.text}</p>
                  <p className={cn("mt-1 text-[10px]", message.from === "me" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {message.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border/70 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message..." className="flex-1" />
            <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      ) : null}

      {tab === "plans" ? (
        <EmptyState icon={FileText} className="!shadow-none" title="No group plans yet" description="Plans shared with this group will appear here." />
      ) : null}

      {tab === "polls" ? (
        <EmptyState icon={Vote} className="!shadow-none" title="No polls yet" description="Create a poll to make group decisions together." />
      ) : null}

      {tab === "members" ? (
        <div className="space-y-2">
          {seedMembers.map((member) => (
            <div key={member} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
              <GlowAvatar name={member} size="sm" />
              <span className="text-sm font-medium">{member}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "files" ? (
        <EmptyState icon={FileText} className="!shadow-none" title="No files shared yet" description="Files shared in this group will appear here." />
      ) : null}
    </div>
  );
}
