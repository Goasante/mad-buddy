export const CANCELLATION_REASONS = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "not_using_enough", label: "Not using it enough" },
  { value: "friends_not_using", label: "Friends aren't using Mad Buddy" },
  { value: "missing_feature", label: "Missing a feature" },
  { value: "technical_problems", label: "Technical problems" },
  { value: "privacy_concerns", label: "Privacy concerns" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" }
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number]["value"];

export function cancellationReasonLabel(value: string) {
  return CANCELLATION_REASONS.find((reason) => reason.value === value)?.label ?? "Prefer not to say";
}
