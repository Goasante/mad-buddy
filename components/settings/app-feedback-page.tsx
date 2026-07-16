"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FeedbackTab = "feedback" | "suggestions";

export function AppFeedbackPage() {
  const [tab, setTab] = useState<FeedbackTab>("feedback");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="mr-auto max-w-[560px] space-y-6 pt-6">
      <SettingsSubHeader title="Send feedback" description="Help us build a better Mad Buddy." />

      <PreviewNotice />

      <div className="flex gap-1 border-b border-border/70">
        {(["feedback", "suggestions"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium capitalize",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {submitted ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-800 dark:text-emerald-100">
          Thanks — your {tab} was sent.
        </div>
      ) : (
        <div className="space-y-4">
          {tab === "feedback" ? (
            <div>
              <p className="mb-2 text-sm font-medium">How would you rate Mad Buddy?</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                    className="focus-ring safe-motion"
                  >
                    <Star
                      className={cn("h-7 w-7", value <= rating ? "fill-primary text-primary" : "text-muted-foreground")}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={tab === "feedback" ? "Tell us more (optional)" : "Share your idea for Mad Buddy"}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">{message.length}/500</p>

          <Button
            type="button"
            className="w-full"
            disabled={tab === "feedback" ? rating === 0 : message.trim().length < 3}
            onClick={() => setSubmitted(true)}
          >
            Send {tab}
          </Button>
        </div>
      )}
    </div>
  );
}
