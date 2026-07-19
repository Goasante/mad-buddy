"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { FormField } from "@/components/auth/form-field";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { cn } from "@/lib/utils";

const languages = ["English (US)", "English (UK)", "Twi", "French"];
const regions = ["Ghana (GH)", "Nigeria (NG)", "United States (US)", "United Kingdom (UK)"];
const timeZones = ["(GMT+0:00) Accra", "(GMT+1:00) Lagos", "(GMT-5:00) New York", "(GMT+0:00) London"];
const dateFormats = ["DD MMM YYYY", "MM/DD/YYYY", "DD/MM/YYYY"];

export function LanguageRegionPage() {
  const [language, setLanguage] = useState(languages[0]);
  const [region, setRegion] = useState(regions[0]);
  const [timeZone, setTimeZone] = useState(timeZones[0]);
  const [dateFormat, setDateFormat] = useState(dateFormats[0]);
  const [timeFormat, setTimeFormat] = useState<"12h" | "24h">("24h");
  const [feedback, setFeedback] = useState("");

  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Language & Region" description="Choose your preferred language and region." />

      <PreviewNotice />

      <div className="space-y-4">
        <FormField htmlFor="language" label="Language">
          <SelectField id="language" value={language} onChange={setLanguage} options={languages} />
        </FormField>
        <FormField htmlFor="region" label="Region">
          <SelectField id="region" value={region} onChange={setRegion} options={regions} />
        </FormField>
        <FormField htmlFor="timeZone" label="Time zone">
          <SelectField id="timeZone" value={timeZone} onChange={setTimeZone} options={timeZones} />
        </FormField>
        <FormField htmlFor="dateFormat" label="Date format">
          <SelectField id="dateFormat" value={dateFormat} onChange={setDateFormat} options={dateFormats} />
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
      <Button type="button" onClick={() => setFeedback("Preferences saved.")}>
        Save preferences
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
