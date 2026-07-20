"use client";

import { Gift, Lock, LockOpen, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import {
  createDropAction,
  getUnlockedDropAction,
  unlockDropAction,
  type DropListItem,
  type UnlockedDrop
} from "@/app/(app)/drops-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MomentImage } from "@/components/ui/moment-image";
import { Textarea } from "@/components/ui/textarea";

export type DropContextOption = { id: string; label: string; contextType: "circle" | "plan" };

/**
 * Muddy Drops (batch 6 §22-§33): content that unlocks inside a shared
 * context. Locked content never reaches the client, unlocking re-verifies
 * membership server-side.
 */
export function DropsPageContent({
  initialDrops = [],
  contexts = []
}: {
  initialDrops?: DropListItem[];
  contexts?: DropContextOption[];
}) {
  const [drops, setDrops] = useState(initialDrops);
  const [createOpen, setCreateOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<UnlockedDrop | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function unlock(drop: DropListItem) {
    startTransition(async () => {
      if (!drop.unlocked) {
        const result = await unlockDropAction(drop.id);
        setFeedback(result.message);
        if (!result.ok) return;
        setDrops((current) =>
          current.map((item) => (item.id === drop.id ? { ...item, unlocked: true } : item))
        );
      }
      setOpenDrop(await getUnlockedDropAction(drop.id));
    });
  }

  // Regenerate the Drop's signed media URL when it fails to load (likely an
  // expired signed URL). MomentImage calls this once before falling back.
  function refreshOpenDropMedia(dropId: string) {
    startTransition(async () => {
      const refreshed = await getUnlockedDropAction(dropId);
      if (refreshed?.mediaUrl) setOpenDrop(refreshed);
    });
  }

  function create(input: { contextType: "circle" | "plan"; contextId: string; text: string; hours: number }) {
    startTransition(async () => {
      const result = await createDropAction({
        dropType: input.contextType,
        contextType: input.contextType,
        contextId: input.contextId,
        contentType: "text",
        textContent: input.text,
        expiresAt: new Date(Date.now() + input.hours * 60 * 60 * 1000).toISOString()
      });
      setFeedback(result.message);
      if (result.ok && result.dropId) {
        setCreateOpen(false);
        const context = contexts.find((option) => option.id === input.contextId);
        setDrops((current) => [
          {
            id: result.dropId as string,
            contextLabel: context?.label ?? "A shared space",
            creatorName: "You",
            isMine: true,
            unlocked: true,
            contentType: "text",
            expiresAt: new Date(Date.now() + input.hours * 60 * 60 * 1000).toISOString()
          },
          ...current
        ]);
      }
    });
  }

  return (
    <div className="mx-auto max-w-[800px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Muddy Drops</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Leave something for a circle, plan, or event. Only people inside can unlock it.
          </p>
        </div>
        {contexts.length > 0 ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Drop
          </Button>
        ) : null}
      </header>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      {drops.length === 0 ? (
        <EmptyState
          icon={Gift}
          className="!min-h-0 !shadow-none p-5"
          title="No Drops right now"
          description="When someone leaves a Drop in one of your circles, plans, or events, it shows up here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {drops.map((drop) => (
            <Card key={drop.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{drop.contextLabel}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    From {drop.creatorName} · until{" "}
                    {new Date(drop.expiresAt).toLocaleString([], {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </p>
                </div>
                {drop.unlocked ? (
                  <LockOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              <Button
                type="button"
                variant={drop.unlocked ? "outline" : "primary"}
                className="mt-4 w-full"
                disabled={isPending}
                onClick={() => unlock(drop)}
              >
                {drop.unlocked ? "View Drop" : "Unlock Drop"}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <CreateDropModal
        open={createOpen}
        contexts={contexts}
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreate={create}
      />

      <Modal
        open={Boolean(openDrop)}
        onOpenChange={(open) => {
          if (!open) setOpenDrop(null);
        }}
        title="You unlocked a Drop"
        description={openDrop ? `From ${openDrop.creatorName}` : undefined}
      >
        {openDrop ? (
          <div className="space-y-3">
            {openDrop.textContent ? <p className="text-sm leading-6">{openDrop.textContent}</p> : null}
            {openDrop.mediaUrl ? (
              <MomentImage
                src={openDrop.mediaUrl}
                alt={`Drop from ${openDrop.creatorName}`}
                className="max-h-[420px] rounded-xl"
                fallbackClassName="min-h-48 rounded-xl"
                onRetry={() => refreshOpenDropMedia(openDrop.id)}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Disappears{" "}
              {new Date(openDrop.expiresAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
              .
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CreateDropModal({
  open,
  contexts,
  pending,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  contexts: DropContextOption[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { contextType: "circle" | "plan"; contextId: string; text: string; hours: number }) => void;
}) {
  const [contextId, setContextId] = useState(contexts[0]?.id ?? "");
  const [text, setText] = useState("");
  const [hours, setHours] = useState("24");

  const context = contexts.find((option) => option.id === contextId) ?? contexts[0];
  const valid = Boolean(context) && text.trim().length > 0;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New Drop" description="Only people inside the context can unlock it.">
      <div className="space-y-4">
        <FormField htmlFor="drop-context" label="Where does it live?">
          <AppSelect
            id="drop-context"
            value={context?.id ?? ""}
            options={contexts.map((option) => ({
              value: option.id,
              label: option.label,
              description: option.contextType === "circle" ? "Circle" : "Plan"
            }))}
            placeholder="Choose a circle or plan"
            onChange={setContextId}
          />
        </FormField>
        <FormField htmlFor="drop-text" label="Message">
          <Textarea
            id="drop-text"
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            placeholder="Leave a note, a hint, a surprise…"
          />
        </FormField>
        <FormField htmlFor="drop-hours" label="Disappears after (hours)">
          <Input
            id="drop-hours"
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </FormField>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!valid || pending}
          onClick={() => {
            if (!context) return;
            const parsedHours = Math.min(Math.max(Number(hours) || 24, 1), 168);
            onCreate({ contextType: context.contextType, contextId: context.id, text: text.trim(), hours: parsedHours });
            setText("");
          }}
        >
          Drop it
        </Button>
      </div>
    </Modal>
  );
}
