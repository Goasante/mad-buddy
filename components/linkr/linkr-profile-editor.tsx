"use client";

import { useState } from "react";
import { ArrowLeft, Camera, Star } from "lucide-react";

import { LINKR_INTENTS, type LinkrIntent } from "@/lib/linkr/intent";
import { PRIMARY_SLOT, orderedPhotos } from "@/lib/linkr/photos";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";

/**
 * Screens 9 and 10: Your Linkr Profile, and Edit photos.
 *
 * Every control here is wired to a real action. There are no placeholder
 * buttons: an "Add photo" tile that opens nothing is worse than no tile,
 * because it makes the whole editor untrustworthy.
 */

export type ProfileEditorProps = {
  profile: LinkrOwnProfile;
  onSave: (input: { intent: LinkrIntent; bio: string; interests: string[] }) => Promise<void>;
  /** Opens the canonical Profile media editor. Linkr has no uploader. */
  onEditProfilePhotos: () => void;
  onPreview: () => void;
  onBack: () => void;
  busy?: boolean;
};

export function LinkrProfileEditor({
  profile,
  onSave,
  onEditProfilePhotos,
  onPreview,
  onBack,
  busy
}: ProfileEditorProps) {
  const [intent, setIntent] = useState<LinkrIntent>(profile.intent);
  const [bio, setBio] = useState(profile.bio);
  const [interests, setInterests] = useState<string[]>(profile.interests);
  const [draftInterest, setDraftInterest] = useState("");

  const addInterest = () => {
    const value = draftInterest.trim();
    if (!value || interests.includes(value) || interests.length >= 8) return;
    setInterests((current) => [...current, value]);
    setDraftInterest("");
  };

  const primary = profile.photos.find((photo) => photo.position === PRIMARY_SLOT);

  return (
    <section className="linkr-sheet" aria-labelledby="linkr-profile-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-profile-title">My Linkr profile</h1>
        <span />
      </header>

      <div className="linkr-sheet__body">
        <div className="linkr-profile__identity">
          <button
            type="button"
            className="linkr-profile__avatar"
            onClick={onEditProfilePhotos}
            aria-label="Edit your photos"
          >
            {primary ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed media URL
              <img src={primary.url} alt="" />
            ) : (
              <span className="linkr-profile__avatar-empty" aria-hidden>
                <Camera />
              </span>
            )}
            <span className="linkr-profile__avatar-badge" aria-hidden>
              <Camera />
            </span>
          </button>
          <p className="linkr-profile__name">
            {profile.displayName}
            {profile.age !== null ? `, ${profile.age}` : ""}
          </p>
        </div>

        {profile.missingRequirements.length > 0 ? (
          <p className="linkr-profile__blockers" role="status">
            Before people can see you: {profile.missingRequirements.join(" · ")}
          </p>
        ) : null}

        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">Intent</legend>
          <div role="radiogroup" aria-label="Intent" className="linkr-intent__options">
            {LINKR_INTENTS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={intent === option.id}
                className={`linkr-pill ${intent === option.id ? "is-selected" : ""}`}
                onClick={() => setIntent(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">About me</legend>
          <textarea
            className="linkr-textarea"
            value={bio}
            maxLength={120}
            rows={3}
            onChange={(event) => setBio(event.target.value)}
            placeholder="A line strangers will read before deciding to say hello."
            aria-describedby="linkr-bio-count"
          />
          <p id="linkr-bio-count" className="linkr-field__count">
            {bio.length}/120
          </p>
        </fieldset>

        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">Interests</legend>
          <ul className="linkr-intent__options">
            {interests.map((interest) => (
              <li key={interest}>
                <button
                  type="button"
                  className="linkr-pill is-selected"
                  onClick={() => setInterests((current) => current.filter((item) => item !== interest))}
                  aria-label={`Remove ${interest}`}
                >
                  {interest} <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
          {interests.length < 8 ? (
            <div className="linkr-field__row">
              <input
                className="linkr-input"
                value={draftInterest}
                maxLength={40}
                onChange={(event) => setDraftInterest(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addInterest();
                  }
                }}
                placeholder="Add an interest"
                aria-label="Add an interest"
              />
              <button type="button" className="linkr-secondary" onClick={addInterest}>
                Add
              </button>
            </div>
          ) : null}
        </fieldset>

        {/* --- Your photos --------------------------------------------------
            A window onto Profile's media, not an editor. Shows exactly what
            candidates will see, and sends the person to the one place these
            photos are actually managed. */}
        <fieldset className="linkr-field">
          <legend className="linkr-field__legend">Your photos</legend>
          <p className="linkr-field__note">Linkr uses photos from your Mad Buddy profile.</p>

          {profile.photos.length > 0 ? (
            <ul className="linkr-photo-strip">
              {orderedPhotos(profile.photos).map((photo, index) => (
                <li key={photo.id} className="linkr-photo-strip__item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL */}
                  <img src={photo.url} alt="" />
                  {index === 0 ? (
                    <span className="linkr-photo-strip__badge">
                      <Star aria-hidden /> Profile
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="linkr-field__note">
              Add a profile photo so people can recognise you.
            </p>
          )}

          <button type="button" className="linkr-secondary" onClick={onEditProfilePhotos}>
            Edit profile photos
          </button>
        </fieldset>

        <button type="button" className="linkr-secondary" onClick={onPreview}>
          Preview my Linkr card
        </button>
      </div>

      <button
        type="button"
        className="linkr-primary"
        onClick={() => onSave({ intent, bio, interests })}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The photo editor that used to live here is GONE.
//
// Linkr does not manage identity imagery. The profile picture and showcase
// photos belong to Profile, and Linkr shows a stranger-safe projection of
// them. A second uploader here would let somebody change their Linkr face
// without changing their Mad Buddy face -- two answers to the same question.
// ---------------------------------------------------------------------------
