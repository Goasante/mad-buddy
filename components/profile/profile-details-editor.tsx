"use client";

import { useState, useTransition } from "react";
import { updateProfileDetailsAction, type ProfileDetails } from "@/app/(app)/profile-actions";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FieldVisibility, ProfileField } from "@/lib/profile/rules";

const audienceOptions: Array<{ value: FieldVisibility; label: string }> = [
  { value: "only_me", label: "Only me" },
  { value: "close_friends", label: "Close Muddies" },
  { value: "approved_muddies", label: "All Muddies" },
  { value: "shared_communities", label: "People in my groups" }
];

type EditableField = {
  field: Exclude<ProfileField, "bio" | "graduation_year">;
  label: string;
  placeholder: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
};

export function ProfileDetailsEditor({ initialDetails }: { initialDetails: ProfileDetails }) {
  const [institution, setInstitution] = useState(initialDetails.institution);
  const [programme, setProgramme] = useState(initialDetails.programme);
  const [generalArea, setGeneralArea] = useState(initialDetails.generalArea);
  const [pronouns, setPronouns] = useState(initialDetails.pronouns);
  const [interestsText, setInterestsText] = useState(initialDetails.interests.join(", "));
  const [privacy, setPrivacy] = useState(initialDetails.privacy);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const contextFields: EditableField[] = [
    {
      field: "institution",
      label: "Organisation or community",
      placeholder: "Workplace, school, organisation, or community",
      value: institution,
      onChange: setInstitution
    },
    {
      field: "programme",
      label: "What you do",
      placeholder: "Role, profession, field, or course",
      value: programme,
      onChange: setProgramme
    }
  ];

  const personalFields: EditableField[] = [
    {
      field: "general_area",
      label: "General area",
      placeholder: "For example, East Legon or central Accra",
      helper: "Keep this broad. Never enter an exact address.",
      value: generalArea,
      onChange: setGeneralArea
    },
    {
      field: "pronouns",
      label: "Pronouns",
      placeholder: "Optional",
      value: pronouns,
      onChange: setPronouns
    },
    {
      field: "interests",
      label: "Interests",
      placeholder: "Music, football, food, travel",
      helper: "Separate interests with commas. Add up to 10.",
      value: interestsText,
      onChange: setInterestsText,
      wide: true
    }
  ];

  function save() {
    setFeedback("");
    startTransition(async () => {
      const result = await updateProfileDetailsAction({
        institution,
        programme,
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
    <Card className="overflow-hidden">
      <header className="border-b border-border/70 px-5 py-5 sm:px-6">
        <h2 className="text-lg font-semibold">Personal details</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Share only what helps approved friends recognise you. Every field is optional, and you choose who can see it.
        </p>
      </header>

      {feedback ? (
        <p className="mx-5 mt-5 rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground sm:mx-6" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="px-5 py-5 sm:px-6">
        <ProfileDetailsSection
          title="Everyday context"
          description="A little context about where you spend your time and what you do."
          fields={contextFields}
          privacy={privacy}
          setPrivacy={setPrivacy}
        />

        <div className="my-6 border-t border-border/70" />

        <ProfileDetailsSection
          title="About you"
          description="Simple details that can make your profile easier to recognise."
          fields={personalFields}
          privacy={privacy}
          setPrivacy={setPrivacy}
        />
      </div>

      <footer className="flex flex-col gap-3 border-t border-border/70 bg-secondary/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-5 text-muted-foreground">Nothing here is visible beyond the audience you choose.</p>
        <Button type="button" onClick={save} disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Saving..." : "Save personal details"}
        </Button>
      </footer>
    </Card>
  );
}

function ProfileDetailsSection({
  title,
  description,
  fields,
  privacy,
  setPrivacy
}: {
  title: string;
  description: string;
  fields: EditableField[];
  privacy: Record<ProfileField, FieldVisibility>;
  setPrivacy: React.Dispatch<React.SetStateAction<Record<ProfileField, FieldVisibility>>>;
}) {
  return (
    <section aria-labelledby={`profile-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div>
        <h3 id={`profile-section-${title.toLowerCase().replace(/\s+/g, "-")}`} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>

      <div className="mt-4 grid gap-x-5 gap-y-6 sm:grid-cols-2">
        {fields.map((field) => (
          <DetailField
            key={field.field}
            {...field}
            audience={privacy[field.field]}
            onAudienceChange={(audience) =>
              setPrivacy((current) => ({
                ...current,
                [field.field]: audience
              }))
            }
          />
        ))}
      </div>
    </section>
  );
}

function DetailField({
  field,
  label,
  placeholder,
  helper,
  value,
  onChange,
  wide,
  audience,
  onAudienceChange
}: EditableField & {
  audience: FieldVisibility;
  onAudienceChange: (audience: FieldVisibility) => void;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={`detail-${field}`} className="text-sm font-semibold">
        {label}
      </label>
      {helper ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{helper}</p> : null}
      <Input
        id={`detail-${field}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Who can see this?</span>
        <AppSelect
          id={`detail-${field}-audience`}
          label={`Who can see ${label}`}
          className="w-auto [&>label]:sr-only"
          value={audience}
          options={audienceOptions}
          size="compact"
          triggerClassName="min-h-8 w-[158px] bg-secondary/45 py-0 text-xs sm:w-[172px]"
          onChange={(next) => onAudienceChange(next as FieldVisibility)}
        />
      </div>
    </div>
  );
}
