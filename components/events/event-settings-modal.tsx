"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  getAudienceOptionsAction,
  getEventAudienceSettingsAction,
  updateEventAudienceSettingsAction
} from "@/app/(app)/event-actions";
import {
  AudienceSelector,
  type AudienceValue,
  type EventAudience
} from "@/components/events/audience-selector";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type SettingsProjection = Awaited<ReturnType<typeof getEventAudienceSettingsAction>>;

export function EventSettingsModal({
  open,
  onOpenChange,
  eventId,
  eventName,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  eventName: string | null;
  onSaved: (visibility: EventAudience, message: string) => void;
}) {
  const [projection, setProjection] = useState<SettingsProjection>(null);
  const [audience, setAudience] = useState<AudienceValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !eventId) return;
    let active = true;
    setLoading(true);
    setError("");
    setProjection(null);
    setAudience(null);

    void getEventAudienceSettingsAction(eventId)
      .then((next) => {
        if (!active) return;
        setProjection(next);
        if (!next) {
          setError("Event settings aren't available.");
          return;
        }
        setAudience({
          visibility: next.visibility,
          targetIds: next.targetIds,
          location: next.location
        });
      })
      .catch(() => {
        if (active) setError("Event settings couldn't be loaded. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId, open]);

  const ended = projection?.status === "ended" || projection?.status === "cancelled";
  const targetMissing =
    audience?.visibility === "invite" || audience?.visibility === "community"
      ? audience.targetIds.length === 0
      : false;
  const nearbyMissing = audience?.visibility === "nearby" && !audience.location;
  const canSave = Boolean(audience && !ended && !targetMissing && !nearbyMissing && !loading && !saving);

  async function save() {
    if (!eventId || !audience || !canSave) return;
    setSaving(true);
    setError("");
    try {
      const result = await updateEventAudienceSettingsAction(eventId, {
        visibility: audience.visibility,
        targetIds: audience.targetIds,
        location: audience.location
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(audience.visibility, result.message);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      owner="EventSettingsModal"
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Event settings"
      description={eventName ? `Control who can find and open ${eventName}.` : "Control who can find and open this Event."}
      widthClassName="sm:max-w-xl"
    >
      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading Event settings…
        </div>
      ) : error && !audience ? (
        <div className="space-y-3 rounded-xl bg-secondary/45 p-4">
          <p role="alert" className="text-sm">{error}</p>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      ) : audience ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl bg-secondary/35 p-3.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Who can find this Event</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                You can switch between invited people, link-only, a community, nearby discovery and public.
              </p>
            </div>
          </div>

          {ended ? (
            <p role="status" className="rounded-xl bg-secondary/45 p-3 text-sm text-muted-foreground">
              This Event has ended, so its audience is kept as history and can no longer be changed.
            </p>
          ) : (
            <AudienceSelector
              value={audience}
              onChange={setAudience}
              loadOptions={getAudienceOptionsAction}
              hint="You can change this after publishing too. Changes apply as soon as you save."
            />
          )}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          {!ended ? (
            <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border/60 bg-card px-4 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" className="flex-1" onClick={save} disabled={!canSave}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  "Save audience"
                )}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
