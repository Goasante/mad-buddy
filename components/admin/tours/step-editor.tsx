"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createStepAction,
  deleteStepAction,
  duplicateStepAction,
  moveStepAction,
  updateStepAction
} from "@/app/(admin)/admin/tours/authoring-actions";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { TOUR_ROUTES, TOUR_TARGETS, targetLabel } from "@/lib/tours/registry";
import { cn } from "@/lib/utils";

type Step = {
  stepKey: string;
  position: number;
  title: string;
  body: string;
  targetId: string | null;
  route: string | null;
  mediaPath: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  requiresFeatureFlag: string | null;
  entitlementKeys: string[];
};

type Draft = Omit<Step, "position">;

const EMPTY: Draft = {
  stepKey: "",
  title: "",
  body: "",
  targetId: null,
  route: null,
  mediaPath: null,
  ctaLabel: null,
  ctaHref: null,
  requiresFeatureFlag: null,
  entitlementKeys: []
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Step authoring for a DRAFT version. Read-only once published: the parent page
 * passes `editable={false}` then, because published steps back recorded
 * completions and analytics.
 *
 * Editing happens in a sheet rather than inline so the list stays scannable, and
 * saves are explicit — no autosave on keystroke, which would mean a Supabase
 * write per character.
 */
export function StepEditor({
  versionId,
  steps,
  editable,
  featureOptions
}: {
  versionId: string;
  steps: Step[];
  editable: boolean;
  /** Managed features, passed from the server so this client bundle does not
   * pull in the server-only feature-flag module. */
  featureOptions: Array<{ key: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [undoDraft, setUndoDraft] = useState<Draft | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; message: string }>, onOk?: () => void) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) onOk?.();
    });
  };

  const openNew = () => {
    setEditingKey(null);
    setDraft(EMPTY);
    setTouched({});
    setUndoDraft(null);
    setOpen(true);
  };

  const openEdit = (step: Step) => {
    setEditingKey(step.stepKey);
    const { position, ...rest } = step;
    void position;
    setDraft(rest);
    setTouched({});
    setUndoDraft(null);
    setOpen(true);
  };

  // Validate on blur, then live once a field has been touched, so an error
  // clears the moment it is fixed but never appears mid-first-keystroke.
  const errorFor = (field: keyof Draft): string | null => {
    if (!touched[field]) return null;
    if (field === "stepKey" && !/^[a-z0-9-]{2,64}$/.test(draft.stepKey)) {
      return "Lowercase letters, numbers and hyphens, at least 2 characters.";
    }
    if (field === "title" && draft.title.trim().length < 2) return "Add a title.";
    if (field === "body" && draft.body.trim().length < 2) return "Add body copy.";
    if (field === "ctaHref" && draft.ctaHref && !draft.ctaLabel) return "A link needs a button label.";
    return null;
  };

  const canSave =
    /^[a-z0-9-]{2,64}$/.test(draft.stepKey) &&
    draft.title.trim().length >= 2 &&
    draft.body.trim().length >= 2 &&
    !(draft.ctaHref && !draft.ctaLabel);

  const save = () => {
    const payload = {
      versionId,
      step: {
        ...draft,
        title: draft.title.trim(),
        body: draft.body.trim(),
        entitlementKeys: draft.entitlementKeys
      }
    };
    run(
      () => (editingKey ? updateStepAction({ ...payload, stepKey: editingKey }) : createStepAction(payload)),
      () => setOpen(false)
    );
  };

  return (
    <div className="space-y-3">
      {feedback ? (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm",
            feedback.ok ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-100" : "bg-destructive/10 text-destructive"
          )}
          role="status"
        >
          <span className="min-w-0">{feedback.message}</span>
          {/* Deleting a draft step is fully reversible, so Undo replaces a
              confirmation dialog rather than adding one. */}
          {undoDraft ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                const restore = undoDraft;
                setUndoDraft(null);
                run(() => createStepAction({ versionId, step: restore }));
              }}
            >
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}

      {steps.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No steps yet. {editable ? "Add the first step to describe what users will see." : ""}
        </Card>
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden p-0">
          {steps.map((step, index) => (
            <div key={step.stepKey} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  <span className="text-muted-foreground">{step.position}. </span>
                  {step.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.body}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[0.6875rem] text-muted-foreground">
                  <span>{step.stepKey}</span>
                  {step.route ? <span>{step.route}</span> : null}
                  {step.targetId ? <span>Target: {targetLabel(step.targetId)}</span> : null}
                  {step.requiresFeatureFlag ? <span>Needs: {step.requiresFeatureFlag}</span> : null}
                </p>
              </div>

              {editable ? (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Explicit reorder buttons always available; they are the
                      keyboard-accessible path and the only path on touch. */}
                  <button
                    type="button"
                    aria-label={`Move ${step.title} up`}
                    disabled={index === 0 || isPending}
                    onClick={() => run(() => moveStepAction({ versionId, stepKey: step.stepKey, direction: "up" }))}
                    className="focus-ring grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-40"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${step.title} down`}
                    disabled={index === steps.length - 1 || isPending}
                    onClick={() => run(() => moveStepAction({ versionId, stepKey: step.stepKey, direction: "down" }))}
                    className="focus-ring grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-40"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <AppMenu
                    label={`Actions for ${step.title}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${step.title}`}
                        className="focus-ring grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>
                    }
                    items={[
                      {
                        id: "edit",
                        label: "Edit",
                        icon: <Pencil className="h-4 w-4" />,
                        onSelect: () => openEdit(step)
                      },
                      {
                        id: "duplicate",
                        label: "Duplicate",
                        icon: <Copy className="h-4 w-4" />,
                        onSelect: () => run(() => duplicateStepAction({ versionId, stepKey: step.stepKey }))
                      },
                      {
                        id: "delete",
                        label: "Delete step",
                        icon: <Trash2 className="h-4 w-4" />,
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => {
                          const { position, ...rest } = step;
                          void position;
                          setUndoDraft(rest);
                          run(() => deleteStepAction({ versionId, stepKey: step.stepKey }));
                        }
                      }
                    ]}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {editable ? (
        <Button type="button" size="sm" variant="outline" onClick={openNew} disabled={isPending}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add step
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          This version is published, so its steps are read only. Create the next version to make changes.
        </p>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={editingKey ? "Edit step" : "Add step"}
        variant="sheet"
        compact
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={isPending || !canSave}>
              {isPending ? "Saving..." : "Save step"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="step-title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <Input
              id="step-title"
              value={draft.title}
              maxLength={120}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              onChange={(event) => {
                const title = event.target.value;
                // Derive the key from the title until the admin edits it, so a
                // stable key exists without anyone thinking about keys.
                setDraft((current) => ({
                  ...current,
                  title,
                  stepKey: editingKey || touched.stepKey ? current.stepKey : slugify(title)
                }));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">Keep it short and action focused.</p>
            {errorFor("title") ? <p className="mt-1 text-xs text-destructive">{errorFor("title")}</p> : null}
          </div>

          <div>
            <label htmlFor="step-body" className="mb-1 block text-sm font-medium">
              Body
            </label>
            <Textarea
              id="step-body"
              value={draft.body}
              maxLength={600}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Explain one idea. Aim for 1 to 2 short sentences. {draft.body.length}/600
            </p>
            {errorFor("body") ? <p className="mt-1 text-xs text-destructive">{errorFor("body")}</p> : null}
          </div>

          <div>
            <label htmlFor="step-route" className="mb-1 block text-sm font-medium">
              Route
            </label>
            <select
              id="step-route"
              value={draft.route ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, route: event.target.value || null }))}
              className="focus-ring h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            >
              <option value="">Stay on the current screen</option>
              {TOUR_ROUTES.map((route) => (
                <option key={route.path} value={route.path}>
                  {route.label} ({route.path})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="step-target" className="mb-1 block text-sm font-medium">
              Spotlight target
            </label>
            <select
              id="step-target"
              value={draft.targetId ?? ""}
              onChange={(event) => {
                const targetId = event.target.value || null;
                const match = TOUR_TARGETS.find((target) => target.id === targetId);
                // Suggest the route the target actually lives on, so a
                // spotlight cannot be pointed at a screen it is not on.
                setDraft((current) => ({
                  ...current,
                  targetId,
                  route: match && !current.route ? match.route : current.route
                }));
              }}
              className="focus-ring h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            >
              <option value="">No spotlight (plain card)</option>
              {TOUR_TARGETS.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} ({target.id})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              A missing target still renders the step as a plain card, so a tour never breaks.
            </p>
          </div>

          <div>
            <label htmlFor="step-feature" className="mb-1 block text-sm font-medium">
              Feature requirement
            </label>
            <select
              id="step-feature"
              value={draft.requiresFeatureFlag ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, requiresFeatureFlag: event.target.value || null }))
              }
              className="focus-ring h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
            >
              <option value="">No requirement</option>
              {featureOptions.map((feature) => (
                <option key={feature.key} value={feature.key}>
                  {feature.title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The step is skipped automatically when this feature is switched off.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="step-cta-label" className="mb-1 block text-sm font-medium">
                CTA label
              </label>
              <Input
                id="step-cta-label"
                value={draft.ctaLabel ?? ""}
                maxLength={40}
                onChange={(event) => setDraft((current) => ({ ...current, ctaLabel: event.target.value || null }))}
              />
            </div>
            <div>
              <label htmlFor="step-cta-href" className="mb-1 block text-sm font-medium">
                CTA destination
              </label>
              <select
                id="step-cta-href"
                value={draft.ctaHref ?? ""}
                onBlur={() => setTouched((t) => ({ ...t, ctaHref: true }))}
                onChange={(event) => setDraft((current) => ({ ...current, ctaHref: event.target.value || null }))}
                className="focus-ring h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm"
              >
                <option value="">None</option>
                {TOUR_ROUTES.map((route) => (
                  <option key={route.path} value={route.path}>
                    {route.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {errorFor("ctaHref") ? <p className="text-xs text-destructive">{errorFor("ctaHref")}</p> : null}

          <div>
            <label htmlFor="step-media" className="mb-1 block text-sm font-medium">
              Media path (optional)
            </label>
            <Input
              id="step-media"
              value={draft.mediaPath ?? ""}
              placeholder="/tours/main-app-v1/home.webp"
              onChange={(event) => setDraft((current) => ({ ...current, mediaPath: event.target.value || null }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              A bundled asset under public/tours/. Leave empty to spotlight live UI instead, which is preferred.
            </p>
          </div>

          <div>
            <label htmlFor="step-key" className="mb-1 block text-sm font-medium">
              Step key
            </label>
            <Input
              id="step-key"
              value={draft.stepKey}
              maxLength={64}
              onBlur={() => setTouched((t) => ({ ...t, stepKey: true }))}
              onChange={(event) =>
                setDraft((current) => ({ ...current, stepKey: slugify(event.target.value) }))
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Used for analytics and resume. Generated from the title; change it only if you need to.
            </p>
            {errorFor("stepKey") ? <p className="mt-1 text-xs text-destructive">{errorFor("stepKey")}</p> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
