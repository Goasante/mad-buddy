"use client";

import { Eye } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProfileDetailsAction, type ProfileDetails } from "@/app/(app)/profile-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { resolveFieldVisibility, type FieldVisibility, type ProfileField, type ViewerRelationship } from "@/lib/profile/rules";
import { cn } from "@/lib/utils";

const audienceOptions: Array<{ id: FieldVisibility; label: string }> = [
  { id: "only_me", label: "Only me" },
  { id: "close_friends", label: "Close Friends" },
  { id: "approved_muddies", label: "Muddies" },
  { id: "shared_communities", label: "Shared community" }
];

const previewOptions: Array<{ id: ViewerRelationship; label: string }> = [
  { id: "close_friend", label: "a Close Friend" },
  { id: "approved_muddy", label: "a Muddy" },
  { id: "shared_community", label: "same campus" },
  { id: "stranger", label: "a stranger" }
];

type EditableField = {
  field: ProfileField;
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/**
 * Batch-9 profile details with a per-field audience control (spec §12) and a
 * "view as" preview driven by the same resolveFieldVisibility rule the server
 * enforces.
 */
export function ProfileDetailsEditor({ initialDetails }: { initialDetails: ProfileDetails }) {
  const [institution, setInstitution] = useState(initialDetails.institution);
  const [programme, setProgramme] = useState(initialDetails.programme);
  const [graduationYear, setGraduationYear] = useState(
    initialDetails.graduationYear ? String(initialDetails.graduationYear) : ""
  );
  const [generalArea, setGeneralArea] = useState(initialDetails.generalArea);
  const [pronouns, setPronouns] = useState(initialDetails.pronouns);
  const [interestsText, setInterestsText] = useState(initialDetails.interests.join(", "));
  const [privacy, setPrivacy] = useState(initialDetails.privacy);
  const [previewAs, setPreviewAs] = useState<ViewerRelationship | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const fields: EditableField[] = [
    { field: "institution", label: "Institution", value: institution, onChange: setInstitution },
    { field: "programme", label: "Programme", value: programme, onChange: setProgramme },
    { field: "graduation_year", label: "Graduation year", value: graduationYear, onChange: setGraduationYear },
    { field: "general_area", label: "General area (never precise)", value: generalArea, onChange: setGeneralArea },
    { field: "pronouns", label: "Pronouns", value: pronouns, onChange: setPronouns },
    { field: "interests", label: "Interests (comma-separated, up to 10)", value: interestsText, onChange: setInterestsText }
  ];

  function save() {
    startTransition(async () => {
      const parsedYear = Number.parseInt(graduationYear, 10);
      const result = await updateProfileDetailsAction({
        institution,
        programme,
        graduationYear: Number.isFinite(parsedYear) ? parsedYear : null,
        generalArea,
        pronouns,
        interests: interestsText
          .split(",")
          .map((interest) => interest.trim())
          .filter(Boolean)
          .slice(0, 10),
        privacy
      });
      setFeedback(result.message);
    });
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">About you</h2>
          <p className="text-xs text-muted-foreground">Each detail has its own audience. Nothing here is public.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">View as</span>
          <AppSelect
            value={previewAs ?? ""}
            options={[
              { value: "", label: "myself" },
              ...previewOptions.map((option) => ({ value: option.id, label: option.label }))
            ]}
            size="compact"
            triggerClassName="min-h-8 min-w-32 py-0 text-xs"
            onChange={(next) => setPreviewAs((next || null) as ViewerRelationship | null)}
          />
        </div>
      </div>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ field, label, value, onChange }) => {
          const hiddenInPreview =
            previewAs !== null && !resolveFieldVisibility({ visibility: privacy[field], relationship: previewAs });
          return (
            <div key={field} className={cn(hiddenInPreview && "opacity-40")}>
              <FormField htmlFor={`detail-${field}`} label={label}>
                <Input
                  id={`detail-${field}`}
                  value={value}
                  disabled={previewAs !== null}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder={hiddenInPreview ? "Hidden from this viewer" : undefined}
                />
              </FormField>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {audienceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={previewAs !== null}
                    onClick={() => setPrivacy((current) => ({ ...current, [field]: option.id }))}
                    aria-pressed={privacy[field] === option.id}
                    className={cn(
                      "focus-ring safe-motion rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      privacy[field] === option.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Button type="button" onClick={save} disabled={isPending || previewAs !== null}>
        Save details
      </Button>
    </Card>
  );
}
