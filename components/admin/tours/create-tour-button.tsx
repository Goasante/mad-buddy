"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { createTourAction } from "@/app/(admin)/admin/tours/authoring-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: "main", label: "Main walkthrough", hint: "The full app tour. Usually only one is live." },
  { key: "feature", label: "Feature tour", hint: "A short tour for one feature or a what's new note." }
] as const;

const PLANS = [
  { key: "free", label: "Free" },
  { key: "buddy_plus", label: "Buddy Plus" },
  { key: "buddy_pro", label: "Buddy Pro" }
] as const;

const COHORTS = [
  { key: "all", label: "Everyone" },
  { key: "new", label: "New users" },
  { key: "existing", label: "Existing users" }
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Creates a tour and its v1 draft, then opens the editor for it. */
export function CreateTourButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"main" | "feature">("feature");
  const [plans, setPlans] = useState<string[]>(["free", "buddy_plus", "buddy_pro"]);
  const [cohort, setCohort] = useState<"all" | "new" | "existing">("all");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const effectiveSlug = slugEdited ? slug : slugify(title);
  const canCreate = title.trim().length >= 3 && /^[a-z0-9-]{3,64}$/.test(effectiveSlug) && plans.length > 0;

  const create = () => {
    setError("");
    startTransition(async () => {
      const result = await createTourAction({
        slug: effectiveSlug,
        title: title.trim(),
        description: description.trim(),
        kind,
        plans,
        cohort
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      // Straight into the editor: a new tour is an empty draft and the next
      // thing anyone wants to do is add step one.
      if (result.versionId) router.push(`/admin/tours/${result.versionId}` as Route);
    });
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create tour
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create tour"
        description="Starts as a draft. Nothing reaches users until you publish it."
        variant="sheet"
        compact
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={create} disabled={isPending || !canCreate}>
              {isPending ? "Creating..." : "Create draft"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div>
            <label htmlFor="tour-title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <Input
              id="tour-title"
              value={title}
              maxLength={120}
              placeholder="Socialize Radar"
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">Shown to users on the tour invitation.</p>
          </div>

          <div>
            <label htmlFor="tour-slug" className="mb-1 block text-sm font-medium">
              Slug
            </label>
            <Input
              id="tour-slug"
              value={effectiveSlug}
              maxLength={64}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(slugify(event.target.value));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">Internal key. Generated from the title.</p>
          </div>

          <div>
            <label htmlFor="tour-description" className="mb-1 block text-sm font-medium">
              Description (optional)
            </label>
            <Textarea
              id="tour-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Type</legend>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={kind === option.key}
                  onClick={() => setKind(option.key)}
                  className={cn(
                    "focus-ring safe-motion min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium",
                    kind === option.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{KINDS.find((k) => k.key === kind)?.hint}</p>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Plans</legend>
            <div className="flex flex-wrap gap-1.5">
              {PLANS.map((plan) => {
                const active = plans.includes(plan.key);
                return (
                  <button
                    key={plan.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setPlans((current) =>
                        current.includes(plan.key) ? current.filter((item) => item !== plan.key) : [...current, plan.key]
                      )
                    }
                    className={cn(
                      "focus-ring safe-motion min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium",
                      active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    )}
                  >
                    {plan.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Audience</legend>
            <div className="flex flex-wrap gap-1.5">
              {COHORTS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={cohort === option.key}
                  onClick={() => setCohort(option.key)}
                  className={cn(
                    "focus-ring safe-motion min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium",
                    cohort === option.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              New and existing are split by whether the account was created before this version was published.
            </p>
          </fieldset>
        </div>
      </Modal>
    </>
  );
}
