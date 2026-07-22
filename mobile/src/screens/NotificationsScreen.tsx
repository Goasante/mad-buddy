import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarCheck2,
  Check,
  CheckCheck,
  ChevronDown,
  ListChecks,
  MapPinOff,
  MessageSquare,
  Settings2,
  Trash2
} from "lucide-react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "../components/Spinner";
import { useOverlayDismiss } from "../lib/overlay";
import { api } from "../lib/api";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type Filter = "all" | "unread" | "read";
const filterOptions: { value: Filter; label: string }[] = [
  { value: "all", label: "All updates" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" }
];

function iconFor(type: string) {
  const base = type.split(":")[0];
  if (base.includes("nearby") || base.includes("proximity")) return MapPinOff;
  if (base.startsWith("message")) return MessageSquare;
  if (base.startsWith("plan") || base.includes("rsvp")) return CalendarCheck2;
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
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  useOverlayDismiss(filterOpen, () => setFilterOpen(false));
  useOverlayDismiss(actionsOpen, () => setActionsOpen(false));

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

  const visible = useMemo(
    () =>
      filter === "unread"
        ? items.filter((i) => !i.is_read)
        : filter === "read"
          ? items.filter((i) => i.is_read)
          : items,
    [filter, items]
  );

  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const item of visible) {
      const key = dayBucket(item.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [visible]);

  const unreadCount = items.filter((i) => !i.is_read).length;

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

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelectMode(false);
    setSelected(new Set());
    setActionsOpen(false);
  }

  async function applyBulkRead(isRead: boolean) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setItems((current) => current.map((item) => (idSet.has(item.id) ? { ...item, is_read: isRead } : item)));
    setActionsOpen(false);
    await api.post("/api/notifications", { ids, isRead });
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const previous = items;
    setItems((current) => current.filter((item) => !idSet.has(item.id)));
    exitSelection();
    const result = await api.del<{ deletedIds: string[] }>("/api/notifications", { ids });
    if (!result.ok) {
      setItems(previous);
      setFeedback(result.error);
    }
  }

  const selectedCount = selected.size;
  const filterLabel = filterOptions.find((o) => o.value === filter)!.label;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 pt-6">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pulse</h1>
          <div className="flex items-center gap-2">
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                Mark all as read
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Notification settings"
              onClick={() => navigate("/settings")}
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Updates from your Muddies and account.</p>
      </header>

      {feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}

      {/* Filter + Select controls */}
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            aria-haspopup="listbox"
            className="focus-ring flex min-w-36 items-center justify-between gap-2 rounded-md border border-border bg-card/70 px-3 py-2 text-sm"
          >
            <span>{filter === "unread" && unreadCount > 0 ? `Unread (${unreadCount})` : filterLabel}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", filterOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {filterOpen ? (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setFilterOpen(false)} aria-hidden="true" />
              <div role="listbox" className="absolute left-0 top-full z-[100] mt-1 w-44 rounded-xl border border-border bg-card p-1 shadow-[0_18px_45px_rgba(0,0,0,0.5)]">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={filter === option.value}
                    onClick={() => {
                      setFilter(option.value);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "focus-ring flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm active:bg-secondary",
                      filter === option.value && "text-primary"
                    )}
                  >
                    {option.value === "unread" && unreadCount > 0 ? `${option.label} (${unreadCount})` : option.label}
                    {filter === option.value ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {selectMode ? (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Button type="button" size="sm" variant="outline" onClick={() => (selectedCount > 0 ? setActionsOpen((v) => !v) : undefined)}>
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                {selectedCount > 0 ? `${selectedCount} selected` : "Select"}
              </Button>
              {actionsOpen && selectedCount > 0 ? (
                <>
                  <div className="fixed inset-0 z-[90]" onClick={() => setActionsOpen(false)} aria-hidden="true" />
                  <div role="menu" className="absolute right-0 top-full z-[100] mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-[0_18px_45px_rgba(0,0,0,0.5)]">
                    <MenuItem label="Mark as read" onClick={() => void applyBulkRead(true)} />
                    <MenuItem label="Mark as unread" onClick={() => void applyBulkRead(false)} />
                    <div className="my-1 h-px bg-border" />
                    <MenuItem label={selectedCount === 1 ? "Delete update" : "Delete selected"} destructive onClick={() => void deleteSelected()} />
                    <MenuItem label="Clear selection" onClick={() => setSelected(new Set())} />
                  </div>
                </>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={exitSelection}>
              Done
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setSelectMode(true)}>
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Select
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          {filter === "unread" ? "No unread updates." : filter === "read" ? "No read updates yet." : "You're all caught up."}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, groupItems]) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
              <ul className="overflow-hidden rounded-2xl border border-border">
                {groupItems.map((item, index) => {
                  const Icon = iconFor(item.type);
                  const isSelected = selected.has(item.id);
                  return (
                    <li key={item.id} className={cn("bg-card/40", index > 0 && "border-t border-border")}>
                      <button
                        type="button"
                        onClick={() => (selectMode ? toggleSelected(item.id) : undefined)}
                        className={cn("flex w-full items-start gap-3 p-3 text-left", selectMode && "active:bg-secondary")}
                      >
                        {selectMode ? (
                          <span
                            className={cn(
                              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center self-center rounded-md border",
                              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                            )}
                            aria-hidden="true"
                          >
                            {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                        ) : (
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-semibold">{item.title}</p>
                            {!item.is_read ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{item.message}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
                      </button>
                      {!selectMode ? (
                        <div className="flex justify-end px-3 pb-2">
                          <button
                            type="button"
                            onClick={() => void remove(item.id)}
                            className="focus-ring rounded-lg p-1 text-muted-foreground hover:text-destructive"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "focus-ring w-full rounded-lg px-2.5 py-2 text-left text-sm active:bg-secondary",
        destructive ? "text-destructive" : "text-foreground"
      )}
    >
      {label}
    </button>
  );
}
