"use client";

import { useState } from "react";
import { ArrowLeft, Check, Globe2, MapPin, Radio } from "lucide-react";

import { LINKR_INTENTS, type LinkrIntent } from "@/lib/linkr/intent";
import { LINKR_DISTANCE_OPTIONS, type LinkrDistancePreference } from "@/lib/linkr/rules";

/**
 * Screen 5: Filters.
 *
 * Every control here is backed by data that actually exists and actually
 * filters. There are no decorative toggles: a switch that does not change the
 * deck teaches people that the filters do not work, which is worse than not
 * offering the filter at all.
 *
 * Distance is three named bands and never a number -- there is no slider, no
 * radius, and no unit anywhere in this component, because the product does not
 * hold a distance it could show even if someone asked for one.
 */

export type LinkrFilterValues = {
  discoveryDistance: LinkrDistancePreference;
  intent: LinkrIntent;
  onlyActiveNow: boolean;
  onlyNewToday: boolean;
  requirePhotos: boolean;
};

export type LinkrFiltersProps = {
  value: LinkrFilterValues;
  onApply: (next: LinkrFilterValues) => void;
  onClose: () => void;
  busy?: boolean;
};

const DEFAULTS: LinkrFilterValues = {
  discoveryDistance: "around_you",
  intent: "friends",
  onlyActiveNow: false,
  onlyNewToday: false,
  requirePhotos: false
};

const DISTANCE_ICONS = { very_close: Radio, around_you: MapPin, wider: Globe2 } as const;

export function LinkrFilters({ value, onApply, onClose, busy }: LinkrFiltersProps) {
  const [draft, setDraft] = useState<LinkrFilterValues>(value);

  return (
    <section className="linkr-sheet" aria-labelledby="linkr-filters-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onClose} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-filters-title">Filters</h1>
        <button type="button" className="linkr-sheet__reset" onClick={() => setDraft(DEFAULTS)}>
          Reset
        </button>
      </header>

      <div className="linkr-sheet__body">
        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">
            <MapPin aria-hidden /> Discovery distance
          </legend>
          <div role="radiogroup" aria-label="Discovery distance" className="linkr-radio-list">
            {LINKR_DISTANCE_OPTIONS.map((option) => {
              const Icon = DISTANCE_ICONS[option.id];
              const selected = draft.discoveryDistance === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`linkr-radio ${selected ? "is-selected" : ""}`}
                  onClick={() => setDraft((current) => ({ ...current, discoveryDistance: option.id }))}
                >
                  <Icon aria-hidden className="linkr-radio__icon" />
                  <span className="linkr-radio__text">
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                  {selected ? <Check aria-hidden className="linkr-radio__check" /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">Intent</legend>
          <div role="radiogroup" aria-label="Intent" className="linkr-intent__options">
            {LINKR_INTENTS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={draft.intent === option.id}
                className={`linkr-pill ${draft.intent === option.id ? "is-selected" : ""}`}
                onClick={() => setDraft((current) => ({ ...current, intent: option.id }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">Show me</legend>
          <div className="linkr-toggle-list">
            <LinkrToggle
              label="Online now"
              hint="People whose device is reporting right now"
              checked={draft.onlyActiveNow}
              onChange={(checked) => setDraft((current) => ({ ...current, onlyActiveNow: checked }))}
            />
            <LinkrToggle
              label="New today"
              hint="People who joined Linkr in the last day"
              checked={draft.onlyNewToday}
              onChange={(checked) => setDraft((current) => ({ ...current, onlyNewToday: checked }))}
            />
            <LinkrToggle
              label="Has photos"
              hint="People with more than a main photo"
              checked={draft.requirePhotos}
              onChange={(checked) => setDraft((current) => ({ ...current, requirePhotos: checked }))}
            />
          </div>
        </fieldset>
      </div>

      <button type="button" className="linkr-primary" onClick={() => onApply(draft)} disabled={busy}>
        {busy ? "Applying…" : "Apply filters"}
      </button>
    </section>
  );
}

/** A labelled switch whose state is announced, not merely coloured. */
function LinkrToggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="linkr-toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="linkr-toggle__text">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span className={`linkr-toggle__track ${checked ? "is-on" : ""}`} aria-hidden>
        <span className="linkr-toggle__thumb" />
      </span>
    </button>
  );
}
