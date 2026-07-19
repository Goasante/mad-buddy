"use client";

import { useState } from "react";
import { useTransition } from "react";
import { updateAppPreferencesAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { FormField } from "@/components/auth/form-field";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { cn } from "@/lib/utils";
import {
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  REGION_OPTIONS,
  TIME_ZONE_OPTIONS,
  type AppPreferences
} from "@/lib/settings/app-preferences";

export function LanguageRegionPage({ initialPreferences }: { initialPreferences: AppPreferences }) {
  const [language, setLanguage] = useState(initialPreferences.language);
  const [region, setRegion] = useState(initialPreferences.region);
  const [timeZone, setTimeZone] = useState(initialPreferences.timeZone);
  const [dateFormat, setDateFormat] = useState(initialPreferences.dateFormat);
  const [timeFormat, setTimeFormat] = useState<"12h" | "24h">(initialPreferences.timeFormat);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Language & Region" description="Choose your preferred language and region." />

      <div className="space-y-4">
        <FormField htmlFor="language" label="Language">
          <SelectField id="language" value={language} onChange={(value) => setLanguage(value as typeof language)} options={[...LANGUAGE_OPTIONS]} />
        </FormField>
        <FormField htmlFor="region" label="Region">
          <SelectField id="region" value={region} onChange={(value) => setRegion(value as typeof region)} options={[...REGION_OPTIONS]} />
        </FormField>
        <FormField htmlFor="timeZone" label="Time zone">
          <SelectField id="timeZone" value={timeZone} onChange={(value) => setTimeZone(value as typeof timeZone)} options={[...TIME_ZONE_OPTIONS]} />
        </FormField>
        <FormField htmlFor="dateFormat" label="Date format">
          <SelectField id="dateFormat" value={dateFormat} onChange={(value) => setDateFormat(value as typeof dateFormat)} options={[...DATE_FORMAT_OPTIONS]} />
        </FormField>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Time format</p>
          <div className="flex gap-2">
            {(["12h", "24h"] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setTimeFormat(format)}
                className={cn(
                  "focus-ring safe-motion rounded-lg border px-4 py-2 text-sm font-medium",
                  timeFormat === format
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {format === "12h" ? "12-hour (AM/PM)" : "24-hour"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
      <Button type="button" disabled={isPending} onClick={() => startTransition(async () => {
        const result = await updateAppPreferencesAction({ language, region, timeZone, dateFormat, timeFormat });
        setFeedback(result.message);
      })}>
        {isPending ? "Saving..." : "Save preferences"}
      </Button>
    </div>
  );
}

function SelectField({
  id,
  value,
  onChange,
  options
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <AppSelect
      id={id}
      value={value}
      options={options.map((option) => ({ value: option, label: option }))}
      onChange={onChange}
    />
  );
}
