"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, RotateCcw } from "lucide-react";
import { loadLinkrRewindRequestsAction } from "@/app/(app)/linkr-actions";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";

import { LINKR_INTENT_LABELS } from "@/lib/linkr/intent";
import { LINKR_DISTANCE_OPTIONS } from "@/lib/linkr/rules";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";
import type { HiddenProfile, LinkrRewindRequest } from "@/lib/linkr/collections-service";

/**
 * Screen 12: Linkr settings.
 *
 * Scoped to Linkr. Account-wide privacy controls are not duplicated here --
 * two switches that both claim to control visibility is how a person ends up
 * believing they are hidden while one of them still says otherwise. Blocking
 * lives in the canonical blocked list and is linked to, not reimplemented.
 */

export type LinkrSettingsProps = {
  profile: LinkrOwnProfile;
  blockedCount: number;
  hiddenProfiles: readonly HiddenProfile[];
  hiddenProfilesLoading?: boolean;
  onRestoreHidden: (userId: string) => Promise<{ ok: boolean; message: string }>;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  onToggleEventMode: (enabled: boolean) => Promise<void>;
  onOpenFilters: () => void;
  onOpenBlocked: () => void;
  onBack: () => void;
  busy?: boolean;
};

export function LinkrSettings({
  profile,
  blockedCount,
  hiddenProfiles,
  hiddenProfilesLoading = false,
  onRestoreHidden,
  onToggleEnabled,
  onToggleEventMode,
  onOpenFilters,
  onOpenBlocked,
  onBack,
  busy
}: LinkrSettingsProps) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [hiddenStatus, setHiddenStatus] = useState<string | null>(null);
  const [rewindRequests, setRewindRequests] = useState<LinkrRewindRequest[]>([]);
  const [rewindRequestsLoading, setRewindRequestsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadLinkrRewindRequestsAction()
      .then((requests) => {
        if (active) setRewindRequests(requests);
      })
      .finally(() => {
        if (active) setRewindRequestsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

        {/* Blocking is account-wide and canonical. Permanent Linkr hides are
            a different, lighter choice and are managed immediately below. */}
        <SettingRow
          label="Blocked people"
          value={blockedCount === 1 ? "1 person" : `${blockedCount} people`}
          onClick={onOpenBlocked}
        />

        <h2 className="linkr-settings__group">Hidden profiles</h2>
        <p className="linkr-settings__note">
          People you chose “Don’t show me again” for. Showing someone again does not connect you or undo a block.
        </p>
        {hiddenProfilesLoading ? (
          <p className="linkr-collection__empty">Loading hidden profiles…</p>
        ) : hiddenProfiles.length === 0 ? (
          <p className="linkr-collection__empty">No hidden profiles.</p>
        ) : (
          <ul className="linkr-collection">
            {hiddenProfiles.map((person) => (
              <li key={person.userId}>
                <div className="linkr-collection__row linkr-collection__row--static">
                  <HiddenFace photo={person.photo} name={person.displayName} />
                  <span className="linkr-collection__text">
                    <span className="flex min-w-0 items-center gap-1.5"><strong className="truncate">{person.displayName}</strong><VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount} compact /></span>
                    <small>Hidden from your Linkr discovery</small>
                  </span>
                  <button
                    type="button"
                    className="linkr-link"
                    disabled={busy || restoringId === person.userId}
                    onClick={() => {
                      void (async () => {
                        setRestoringId(person.userId);
                        const result = await onRestoreHidden(person.userId);
                        setHiddenStatus(result.message);
                        setRestoringId(null);
                      })();
                    }}
                  >
                    <RotateCcw aria-hidden />
                    {restoringId === person.userId ? "Restoring…" : "Show again"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {hiddenStatus ? <p className="linkr-settings__note" role="status">{hiddenStatus}</p> : null}

        <h2 className="linkr-settings__group">Rewind requests</h2>
        <p className="linkr-settings__note">
          Requests you sent after using your three self-service rewinds. Admin decisions stay visible here.
        </p>
        {rewindRequestsLoading ? (
          <p className="linkr-collection__empty">Loading rewind requests…</p>
        ) : rewindRequests.length === 0 ? (
          <p className="linkr-collection__empty">No rewind requests.</p>
        ) : (
          <ul className="linkr-collection">
            {rewindRequests.map((request) => (
              <li key={request.id}>
                <div className="linkr-collection__row linkr-collection__row--static">
                  <HiddenFace photo={request.targetPhoto} name={request.targetDisplayName} />
                  <span className="linkr-collection__text">
                    <strong>{request.targetDisplayName}</strong>
                    <small>{rewindRequestLabel(request)}</small>
                    <small>Requested {new Date(request.createdAt).toLocaleDateString()}</small>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

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


function rewindRequestLabel(request: LinkrRewindRequest): string {
  if (request.decision === "approve") return "Approved — this profile can appear in Linkr again.";
  if (request.decision === "reject") return "Reviewed — the pass stays until its normal expiry.";
  if (["open", "waiting_on_internal_team", "escalated"].includes(request.status)) return "In review";
  if (["resolved", "closed"].includes(request.status)) return "Reviewed";
  return "Sent to Mad Buddy support";
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


function HiddenFace({ photo, name }: { photo: string | null; name: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URL
    <img src={photo} alt="" className="linkr-collection__face" />
  ) : (
    <span className="linkr-collection__face linkr-collection__face--fallback" aria-hidden>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
