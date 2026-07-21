import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
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

  return (
    <Screen title="Alerts">
      {feedback ? <p className="mb-3 text-sm text-destructive">{feedback}</p> : null}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          You're all caught up.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.is_read ? "bg-transparent" : "bg-primary"}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.message}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{formatRelativeTime(item.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => void remove(item.id)}
                className="focus-ring rounded-lg p-1 text-muted-foreground"
                aria-label="Delete notification"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
