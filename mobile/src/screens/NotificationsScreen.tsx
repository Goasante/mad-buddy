import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, ChevronRight, CheckCheck, MapPinOff, Bell, MessageSquare, CalendarCheck2 } from "lucide-react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

function iconFor(type: string) {
  if (type.includes("nearby") || type.includes("proximity")) return MapPinOff;
  if (type.startsWith("message")) return MessageSquare;
  if (type.startsWith("plan") || type.includes("rsvp")) return CalendarCheck2;
  return Bell;
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric" });
}

export function NotificationsScreen() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<{ notifications: Notification[] }>("/api/notifications?limit=50");
    setLoading(false);
    if (result.ok) setItems(result.data.notifications);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    const result = await api.del<{ deletedIds: string[] }>("/api/notifications", { ids: [id] });
    if (!result.ok) {
      setItems(previous);
      setFeedback(result.error);
    }
  }

  async function markAllRead() {
    setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    await api.post("/api/notifications", { markAllRead: true });
  }

  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const item of items) {
      const key = dayBucket(item.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  const hasUnread = items.some((item) => !item.is_read);

  return (
    <Screen
      title="Pulse"
      action={
        hasUnread ? (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Mark all as read
          </button>
        ) : null
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">Updates from your Muddies and account.</p>

      {feedback ? <p className="mb-3 text-sm text-destructive">{feedback}</p> : null}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">You're all caught up.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, groupItems]) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
              <ul className="overflow-hidden rounded-2xl border border-border">
                {groupItems.map((item, index) => {
                  const Icon = iconFor(item.type);
                  return (
                    <li key={item.id} className={cn("flex items-start gap-3 bg-card/40 p-3", index > 0 && "border-t border-border")}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                          {!item.is_read ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{item.message}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => void remove(item.id)}
                        className="focus-ring mt-0.5 shrink-0 rounded-lg p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Screen>
  );
}
