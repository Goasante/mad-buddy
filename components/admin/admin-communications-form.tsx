"use client";

import { useMemo, useState, useTransition } from "react";
import { LoaderCircle, MailCheck, Megaphone } from "lucide-react";
import {
  queueBroadcastCommunicationAction,
  sendCommunicationTestAction
} from "@/app/(admin)/admin/communications/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const audiences = [
  { value: "all_active", label: "All active users" },
  { value: "free", label: "Free users" },
  { value: "paid", label: "All paid users" },
  { value: "buddy_plus", label: "Buddy Plus users" },
  { value: "buddy_pro", label: "Buddy Pro users" }
] as const;

const kinds = [
  { value: "service_notice", label: "Service / downtime notice" },
  { value: "product_update", label: "Product update" },
  { value: "feature_launch", label: "New feature launch" },
  { value: "community_reminder", label: "Community reminder" }
] as const;

type Audience = (typeof audiences)[number]["value"];
type Kind = (typeof kinds)[number]["value"];

export function AdminCommunicationsForm() {
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("all_active");
  const [kind, setKind] = useState<Kind>("product_update");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [testPending, startTestTransition] = useTransition();
  const [broadcastPending, startBroadcastTransition] = useTransition();
  const busy = testPending || broadcastPending;

  const complete = useMemo(
    () => campaignName.trim().length >= 2 && subject.trim().length >= 2 && message.trim().length >= 2,
    [campaignName, subject, message]
  );

  function sendTest() {
    setFeedback("");
    startTestTransition(async () => {
      const result = await sendCommunicationTestAction({
        campaignName: campaignName.trim(),
        subject: subject.trim(),
        message: message.trim(),
        audience,
        kind,
        requestId: crypto.randomUUID()
      });
      setFeedback(result.message);
    });
  }

  function queueCampaign() {
    const requestId = crypto.randomUUID();
    setFeedback("");
    startBroadcastTransition(async () => {
      const result = await queueBroadcastCommunicationAction({
        campaignName: campaignName.trim(),
        subject: subject.trim(),
        message: message.trim(),
        audience,
        kind,
        requestId,
        confirmation: confirmation.trim()
      });
      setFeedback(result.message);
      if (result.ok) {
        setCampaignName("");
        setSubject("");
        setMessage("");
        setConfirmation("");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          Campaign name
          <Input
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            placeholder="September feature launch"
            maxLength={80}
            disabled={busy}
          />
        </label>

        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          Email subject
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Something new just landed in Mad Buddy"
            maxLength={120}
            disabled={busy}
          />
        </label>

        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          Communication type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
            disabled={busy}
            className="focus-ring h-10 w-full rounded-xl border border-border bg-card/60 px-3 text-sm text-foreground outline-none"
          >
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          Audience
          <select
            value={audience}
            onChange={(event) => setAudience(event.target.value as Audience)}
            disabled={busy}
            className="focus-ring h-10 w-full rounded-xl border border-border bg-card/60 px-3 text-sm text-foreground outline-none"
          >
            {audiences.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
        Message
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write the announcement exactly as users should receive it…"
          maxLength={5000}
          rows={10}
          disabled={busy}
        />
        <span className="block text-right text-[11px] text-muted-foreground">{message.length}/5000</span>
      </label>

      <div className="rounded-xl border border-[#E88C2B]/20 bg-[#E88C2B]/[0.06] p-4">
        <p className="text-sm font-semibold text-foreground">Before broadcasting</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Send yourself a test first. A test only goes to your admin account. The final broadcast is a separate action and is queued only after you type SEND and press Queue broadcast.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Type <span className="font-bold text-foreground">SEND</span> to confirm a mass email
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
              placeholder="SEND"
              maxLength={4}
              disabled={busy}
            />
          </label>

          <Button type="button" variant="outline" disabled={busy || !complete} onClick={sendTest}>
            {testPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MailCheck className="h-4 w-4" aria-hidden="true" />}
            {testPending ? "Sending test…" : "Send test to me"}
          </Button>

          <Button type="button" disabled={busy || !complete || confirmation !== "SEND"} onClick={queueCampaign}>
            {broadcastPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Megaphone className="h-4 w-4" aria-hidden="true" />}
            {broadcastPending ? "Queuing broadcast…" : "Queue broadcast"}
          </Button>
        </div>
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}
