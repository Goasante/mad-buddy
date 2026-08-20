"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";

import { LINKR_INTENT_LABELS } from "@/lib/linkr/intent";
import { LINKR_DISTANCE_OPTIONS } from "@/lib/linkr/rules";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";

/**
 * Screen 12: Linkr settings.
 *
 * Scoped to Linkr. Account-wide privacy controls are not duplicated here --
 * two switches that both claim to control visibility is how a person ends up
 * believing they are hidden while one of them still says otherwise. Blocking
 * lives in the canonical Safety centre and is linked to, not reimplemented.
 */

export type LinkrSettingsProps = {
  profile: LinkrOwnProfile;
  hiddenCount: number;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  onToggleEventMode: (enabled: boolean) => Promise<void>;
  onOpenFilters: () => void;
  onOpenBlocked: () => void;
  onBack: () => void;
  busy?: boolean;
};

export function LinkrSettings({
  profile,
  hiddenCount,
  onToggleEnabled,
  onToggleEventMode,
  onOpenFilters,
  onOpenBlocked,
  onBack,
  busy
}: LinkrSettingsProps) {
  const distanceLabel =
    LINKR_DISTANCE_OPTIONS.find((option) => option.id === profile.discoveryDistance)?.label ?? "Around you";

  return (
    <section className="linkr-sheet" aria-labelledby="linkr-settings-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-settings-title">Linkr settings</h1>
        <span />
      </header>

      <div className="linkr-sheet__body">
        <h2 className="linkr-settings__group">Visibility</h2>

        <SettingSwitch
          label="Linkr"
          hint={profile.enabled ? "You are discoverable to others." : "You are not discoverable."}
          checked={profile.enabled}
          disabled={busy}
          onChange={onToggleEnabled}
        />

        <SettingSwitch
          label="Show me in Event Mode"
          hint="Allow people at events to find you."
          checked={profile.eventModeEnabled}
          disabled={busy || !profile.enabled}
          onChange={onToggleEventMode}
        />

        {/* Blocking is account-wide and canonical. Linkr links to it rather
            than keeping a second list that could disagree with the real one. */}
        <SettingRow label="Hide from specific people" value={`${hiddenCount} people`} onClick={onOpenBlocked} />

        <h2 className="linkr-settings__group">Preferences</h2>
        <SettingRow label="Discovery distance" value={distanceLabel} onClick={onOpenFilters} />
        <SettingRow label="Intent" value={LINKR_INTENT_LABELS[profile.intent]} onClick={onOpenFilters} />

        {profile.enabled ? (
          <button
            type="button"
            className="linkr-danger"
            onClick={() => onToggleEnabled(false)}
            disabled={busy}
          >
            Turn off Linkr
          </button>
        ) : null}

        {/* Says exactly what turning it off does, and what it does not do. */}
        <p className="linkr-settings__note">
          Turning Linkr off removes you from new discovery straight away. People you are already
          connected to, and your conversations with them, stay exactly as they are.
        </p>
      </div>
    </section>
  );
}

function SettingSwitch({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="linkr-toggle"
      disabled={disabled}
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

function SettingRow({
  label,
  value,
  onClick
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="linkr-setting-row" onClick={onClick}>
      <span>{label}</span>
      <span className="linkr-setting-row__value">
        {value}
        <ChevronRight aria-hidden />
      </span>
    </button>
  );
}
