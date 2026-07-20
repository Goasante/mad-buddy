"use client";

import { BriefcaseBusiness, Eye, Heart, MapPin, UserRound, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProfileDetailsAction, type ProfileDetails } from "@/app/(app)/profile-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveFieldVisibility, type FieldVisibility, type ProfileField, type ViewerRelationship } from "@/lib/profile/rules";
import { cn } from "@/lib/utils";

const audienceOptions: Array<{ id: FieldVisibility; label: string }> = [
  { id: "only_me", label: "Only me" },
  { id: "close_friends", label: "Close Friends" },
  { id: "approved_muddies", label: "Muddies" },
  { id: "shared_communities", label: "Shared groups" }
];

const previewOptions: Array<{ id: ViewerRelationship; label: string }> = [
  { id: "close_friend", label: "Close Friend" },
  { id: "approved_muddy", label: "Muddy" },
  { id: "shared_community", label: "Group member" },
  { id: "stranger", label: "Someone else" }
];

type EditableField = {
  field: Exclude<ProfileField, "bio" | "graduation_year">;
  label: string;
  placeholder: string;
  helper?: string;
  value: string;
  icon: LucideIcon;
  wide?: boolean;
  onChange: (value: string) => void;
};

export function ProfileDetailsEditor({ initialDetails }: { initialDetails: ProfileDetails }) {
  const [institution, setInstitution] = useState(initialDetails.institution);
  const [programme, setProgramme] = useState(initialDetails.programme);
  const [generalArea, setGeneralArea] = useState(initialDetails.generalArea);
  const [pronouns, setPronouns] = useState(initialDetails.pronouns);
  const [interestsText, setInterestsText] = useState(initialDetails.interests.join(", "));
  const [privacy, setPrivacy] = useState(initialDetails.privacy);
  const [previewAs, setPreviewAs] = useState<ViewerRelationship | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const fields: EditableField[] = [
    {
      field: "institution",
      label: "Work or study",
      placeholder: "Company, school, or community",
      value: institution,
      icon: BriefcaseBusiness,
      onChange: setInstitution
    },
    {
      field: "programme",
      label: "Role or field",
      placeholder: "Your role, profession, field, or course",
      value: programme,
      icon: BriefcaseBusiness,
      onChange: setProgramme
    },
    {
      field: "general_area",
      label: "General area",
      placeholder: "For example, East Legon or central Accra",
      helper: "Keep it broad. Never enter an exact address.",
      value: generalArea,
      icon: MapPin,
      onChange: setGeneralArea
    },
    {
      field: "pronouns",
      label: "Pronouns",
      placeholder: "Optional",
      value: pronouns,
      icon: UserRound,
      onChange: setPronouns
    },
    {
      field: "interests",
      label: "Interests",
      placeholder: "Music, football, food, travel",
      helper: "Separate interests with commas. Add up to 10.",
      value: interestsText,
      icon: Heart,
      wide: true,
      onChange: setInterestsText
    }
  ];

  function save() {
    startTransition(async () => {
      const result = await updateProfileDetailsAction({
        institution,
        programme,
        // Graduation year is no longer a general-profile field, but any
        // previously saved value remains untouched instead of being erased.
        graduationYear: initialDetails.graduationYear,
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
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold">Personal details</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Add optional context that helps approved friends recognise you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">Preview as</span>
          <AppSelect
            id="profile-preview-audience"
            value={previewAs ?? ""}
            options={[
              { value: "", label: "Myself" },
              ...previewOptions.map((option) => ({ value: option.id, label: option.label }))
            ]}
            size="compact"
            triggerClassName="min-h-9 w-[138px] py-0 text-xs"
            onChange={(next) => setPreviewAs((next || null) as ViewerRelationship | null)}
          />
        </div>
      </div>

      {feedback ? (
        <p className="mt-4 rounded-xl bg-secondary/55 px-4 py-3 text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {fields.map(({ field, label, placeholder, helper, value, icon: Icon, wide, onChange }) => {
          const hiddenInPreview =
            previewAs !== null && !resolveFieldVisibility({ visibility: privacy[field], relationship: previewAs });

          return (
            <div
              key={field}
              className={cn(
                "rounded-xl bg-secondary/35 p-4",
                wide && "sm:col-span-2",
                hiddenInPreview && "opacity-65"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background/70 text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <label htmlFor={`detail-${field}`} className="block text-sm font-semibold">
                      {label}
                    </label>
                    {helper ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{helper}</p> : null}
                  </div>
                </div>
                <AppSelect
                  id={`detail-${field}-audience`}
                  label={`Who can see ${label}`}
                  className="[&>label]:sr-only"
                  value={privacy[field]}
                  options={audienceOptions.map((option) => ({ value: option.id, label: option.label }))}
                  size="compact"
                  disabled={previewAs !== null}
                  triggerClassName="min-h-9 w-[138px] bg-background/55 py-0 text-xs"
                  onChange={(next) => setPrivacy((current) => ({ ...current, [field]: next }))}
                />
              </div>
              <Input
                id={`detail-${field}`}
                value={hiddenInPreview ? "" : value}
                disabled={previewAs !== null}
                onChange={(event) => onChange(event.target.value)}
                placeholder={hiddenInPreview ? "Hidden from this person" : placeholder}
                className="mt-3 bg-background/55"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-border/70 pt-4">
        <p className="hidden text-xs text-muted-foreground sm:block">Every detail is optional.</p>
        <Button type="button" onClick={save} disabled={isPending || previewAs !== null}>
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}
