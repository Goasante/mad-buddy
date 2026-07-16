"use client";

import { ArchiveX, ArrowLeft, MessagesSquare, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ConversationKind = "direct" | "plan";

type ChatMessage = {
  id: string;
  from: "me" | "them";
  text: string;
  time: string;
};

type Conversation = {
  id: string;
  name: string;
  kind: ConversationKind;
  subtitle: string;
  unread: number;
  messages: ChatMessage[];
};

const seedConversations: Conversation[] = [
  {
    id: "ama",
    name: "Ama",
    kind: "direct",
    subtitle: "See you there!",
    unread: 2,
    messages: [
      { id: "m1", from: "them", text: "Hey! Are you free this evening?", time: "10:08 AM" },
      { id: "m2", from: "me", text: "Yeah I should be. After class maybe?", time: "10:09 AM" },
      { id: "m3", from: "them", text: "Sounds good. East Legon?", time: "10:10 AM" },
      { id: "m4", from: "me", text: "Perfect. I'll ping the plan.", time: "10:11 AM" },
      { id: "m5", from: "them", text: "See you there!", time: "10:12 AM" }
    ]
  },
  {
    id: "kofi",
    name: "Kofi",
    kind: "direct",
    subtitle: "Cool, we'll do it",
    unread: 0,
    messages: [
      { id: "m1", from: "them", text: "Want to link up this weekend?", time: "Yesterday" },
      { id: "m2", from: "me", text: "Cool, we'll do it", time: "Yesterday" }
    ]
  },
  {
    id: "study-group",
    name: "Study Group",
    kind: "plan",
    subtitle: "Sena: Notes are up",
    unread: 4,
    messages: [
      { id: "m1", from: "them", text: "Notes are up in the shared folder", time: "9:45 AM" },
      { id: "m2", from: "them", text: "Room 2, same as last time", time: "9:47 AM" }
    ]
  },
  {
    id: "nana",
    name: "Nana",
    kind: "direct",
    subtitle: "Let's go!",
    unread: 0,
    messages: [{ id: "m1", from: "them", text: "Let's go!", time: "2 days ago" }]
  },
  {
    id: "efua",
    name: "Efua",
    kind: "direct",
    subtitle: "Thanks!",
    unread: 0,
    messages: [{ id: "m1", from: "them", text: "Thanks!", time: "2 days ago" }]
  }
];

const tabs = [
  { id: "all", label: "Chats" },
  { id: "plan", label: "Plan Chats" },
  { id: "archived", label: "Archived" }
] as const;

type TabId = (typeof tabs)[number]["id"];

export function MessagesPageContent() {
  const [conversations, setConversations] = useState<Conversation[]>(seedConversations);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const matchesTab = activeTab === "all" ? true : activeTab === "plan" ? conversation.kind === "plan" : false;
      const matchesQuery = conversation.name.toLowerCase().includes(query.trim().toLowerCase());
      return matchesTab && matchesQuery;
    });
  }, [conversations, activeTab, query]);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  function openConversation(id: string) {
    setSelectedId(id);
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? { ...conversation, unread: 0 } : conversation))
    );
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || !selected) return;

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              subtitle: text,
              messages: [
                ...conversation.messages,
                { id: `m-${Date.now()}`, from: "me", text, time: "Just now" }
              ]
            }
          : conversation
      )
    );
    setDraft("");
  }

  return (
    <div className="mx-auto max-w-[1200px] pt-6">
      <div className="grid gap-0 overflow-hidden rounded-2xl border border-border/70 md:h-[calc(100vh-9rem)] md:grid-cols-[20rem_minmax(0,1fr)]">
        <div className={cn("flex min-h-0 flex-col border-border/70 md:border-r", selected && "hidden md:flex")}>
          <div className="space-y-3 border-b border-border/70 p-4">
            <h1 className="text-xl font-semibold tracking-tight">Messages</h1>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages"
                className="pl-9"
                aria-label="Search messages"
              />
            </div>
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "focus-ring safe-motion rounded-full px-3 py-1.5 text-xs font-medium",
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === "archived" ? (
              <EmptyState
                icon={ArchiveX}
                className="!min-h-0 !shadow-none m-4 p-5"
                title="No archived chats"
                description="Chats you archive will show up here."
              />
            ) : filteredConversations.length > 0 ? (
              <ul>
                {filteredConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(conversation.id)}
                      className={cn(
                        "focus-ring safe-motion flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left hover:bg-secondary/60",
                        selected?.id === conversation.id && "bg-secondary/70"
                      )}
                    >
                      <GlowAvatar name={conversation.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{conversation.name}</span>
                          {conversation.unread > 0 ? (
                            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                              {conversation.unread}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{conversation.subtitle}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={MessagesSquare}
                className="!min-h-0 !shadow-none m-4 p-5"
                title="No chats found"
                description="Try another search."
              />
            )}
          </div>
        </div>

        <div className={cn("flex min-h-0 flex-col", !selected && "hidden md:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-border/70 p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setSelectedId(null)}
                  aria-label="Back to messages"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <GlowAvatar name={selected.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selected.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.kind === "plan" ? "Plan chat" : "Direct message"}
                  </p>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn("flex", message.from === "me" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-6",
                        message.from === "me"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      )}
                    >
                      <p>{message.text}</p>
                      <p
                        className={cn(
                          "mt-1 text-[10px]",
                          message.from === "me" ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}
                      >
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
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a message..."
                  aria-label="Type a message"
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </form>
            </>
          ) : (
            <div className="hidden flex-1 items-center justify-center p-6 md:flex">
              <EmptyState
                icon={MessagesSquare}
                className="!shadow-none"
                title="Select a chat"
                description="Choose a conversation from the list to start messaging."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
