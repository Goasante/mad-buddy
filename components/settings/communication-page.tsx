"use client";

import { useState, useTransition } from "react";
import { updateCommunicationPreferencesAction } from "@/app/(app)/messaging-actions";
import type { CommunicationPreferences } from "@/lib/messaging/service";
import { cn } from "@/lib/utils";

type ChoiceRow<K extends keyof CommunicationPreferences> = {
  key: K;
  title: string;
  description: string;
  options: Array<{ value: CommunicationPreferences[K]; label: string }>;
};

const messageRows: Array<ChoiceRow<"messagePermission"> | ChoiceRow<"groupAddPermission"> | ChoiceRow<"notificationPreview">> = [
  {
    key: "messagePermission",
    title: "Who can message you",
    description: "Messaging is always limited to approved Muddies at most.",
    options: [
      { value: "all_muddies", label: "All Muddies" },
      { value: "close_friends", label: "Close Friends" },
      { value: "nobody", label: "Nobody" }
    ]
  },
  {
    key: "groupAddPermission",
    title: "Who can add you to groups",
    description: "“Ask me first” sends you an invite instead of adding you silently.",
    options: [
      { value: "anyone", label: "Any Muddy" },
      { value: "close_friends", label: "Close Friends" },
      { value: "ask_me", label: "Ask me first" },
      { value: "nobody", label: "Nobody" }
    ]
  },
  {
    key: "notificationPreview",
    title: "Message previews in notifications",
    description: "What shows on your lock screen when a message arrives.",
    options: [
      { value: "sender_and_message", label: "Sender + message" },
      { value: "sender_only", label: "Sender only" },
      { value: "generic", label: "“New message”" },
      { value: "none", label: "Nothing" }
    ]
  }
];

const toggles: Array<{ key: "readReceiptsEnabled" | "typingIndicatorEnabled" | "presenceEnabled"; title: string; description: string }> = [
  {
    key: "readReceiptsEnabled",
    title: "Read receipts",
    description: "Turning this off also hides when others have read your messages."
  },
  { key: "typingIndicatorEnabled", title: "Typing indicator", description: "Show when you're typing." },
  { key: "presenceEnabled", title: "Active status", description: "Show when you're active in chats." }
];

/** Communication privacy (batch 7 §53-§56). Server re-normalizes everything. */
export function CommunicationSettingsPage({ initialPreferences }: { initialPreferences: CommunicationPreferences }) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(next: CommunicationPreferences) {
    setPrefs(next);
    startTransition(async () => {
      const result = await updateCommunicationPreferencesAction(next);
      setFeedback(result.message);
    });
  }

  return (
    <div className="space-y-5">
      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      {messageRows.map((row) => (
        <div key={row.key} className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="text-sm font-semibold">{row.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                disabled={isPending}
                onClick={() => save({ ...prefs, [row.key]: option.value })}
                aria-pressed={prefs[row.key] === option.value}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  prefs[row.key] === option.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {toggles.map((toggle) => (
        <div
          key={toggle.key}
          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-4"
        >
          <div>
            <p className="text-sm font-semibold">{toggle.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{toggle.description}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[toggle.key]}
            disabled={isPending}
            onClick={() => save({ ...prefs, [toggle.key]: !prefs[toggle.key] })}
            className={cn(
              "focus-ring safe-motion relative h-6 w-11 shrink-0 rounded-full transition-colors",
              prefs[toggle.key] ? "bg-primary" : "bg-border"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                prefs[toggle.key] ? "translate-x-[22px]" : "translate-x-0.5"
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      ))}
    </div>
  );
}
