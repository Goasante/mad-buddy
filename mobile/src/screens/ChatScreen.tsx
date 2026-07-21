import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type ChatMessage = {
  id: string;
  senderName: string;
  isMine: boolean;
  text: string | null;
  quickActionType: string | null;
  createdAt: string;
  deleted: boolean;
};

export function ChatScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const title = messages.find((message) => !message.isMine)?.senderName ?? "Chat";

  const load = useCallback(async () => {
    const result = await api.get<{ messages: ChatMessage[] }>(`/api/messages/conversations/${id}`);
    if (result.ok) setMessages(result.data.messages);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    void api.post(`/api/messages/conversations/${id}/read`);
    // Light polling for new messages while the thread is open.
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [id, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/messages/send", {
      conversationId: id,
      text,
      clientMessageId: crypto.randomUUID()
    });
    setSending(false);
    if (result.ok) await load();
    else setDraft(text);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/80 px-3 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate("/messages")}
          className="focus-ring rounded-lg p-1"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">{title}</h1>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">Say hello 👋</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn("flex", message.isMine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm",
                  message.isMine
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md border border-border bg-card/60"
                )}
              >
                {message.deleted ? (
                  <span className="italic opacity-70">Message deleted</span>
                ) : (
                  message.text ?? (message.quickActionType ? message.quickActionType.replace(/_/g, " ") : "")
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-card/80 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur">
        <Input
          placeholder="Message…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
