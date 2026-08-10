"use client";

import { Loader2, Phone, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  getPhoneIdentityAction,
  removePhoneNumberAction,
  savePhoneNumberAction,
  setContactDiscoveryAction
} from "@/app/(app)/contact-actions";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptic } from "@/lib/device/haptics";
import { cn } from "@/lib/utils";

/**
 * Phone number and contact discovery.
 *
 * TWO SEPARATE DECISIONS, presented as two. Storing a number and being
 * findable by it are different consents, and the toggle stays off until it is
 * turned on deliberately -- adding a number never makes anyone discoverable as
 * a side effect.
 *
 * NOTHING HERE SAYS "VERIFIED". There is no OTP yet, so no number on this
 * screen is proven to belong to its owner. The copy says "added", and there is
 * no tick, no badge and no verification state -- claiming otherwise would be a
 * false statement about a real security property.
 *
 * The number is never shown back in full, only its last four digits. The owner
 * already knows their own number; what they need is enough to recognise which
 * one is on the account.
 */

/**
 * A short list, not a full ISO catalogue.
 *
 * The parser accepts any country when a number is written in international
 * form, so this only helps people typing a national number. Ghana leads
 * because that is where most Mad Buddy users are; anyone elsewhere can type
 * +country and be parsed correctly regardless of what is selected.
 */
const REGIONS = [
  { code: "GH", label: "Ghana (+233)" },
  { code: "NG", label: "Nigeria (+234)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "US", label: "United States (+1)" },
  { code: "CA", label: "Canada (+1)" },
  { code: "ZA", label: "South Africa (+27)" },
  { code: "KE", label: "Kenya (+254)" },
  { code: "DE", label: "Germany (+49)" },
  { code: "FR", label: "France (+33)" },
  { code: "IN", label: "India (+91)" }
] as const;

export function ContactDiscoveryPage() {
  const [hasPhone, setHasPhone] = useState(false);
  const [hint, setHint] = useState("");
  const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [region, setRegion] = useState<string>("GH");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void (async () => {
      const identity = await getPhoneIdentityAction();
      if (!active) return;
      setHasPhone(identity.hasPhone);
      setHint(identity.hint);
      setDiscoveryEnabled(identity.discoveryEnabled);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  function report(result: { ok: boolean; message: string }) {
    setFeedback(result.message);
    // Errors are announced and worded, never colour alone.
    setIsError(!result.ok);
  }

  function savePhone() {
    startTransition(async () => {
      const result = await savePhoneNumberAction({ phoneNumber: phoneInput, region });
      report(result);
      if (result.ok) {
        const identity = await getPhoneIdentityAction();
        setHasPhone(identity.hasPhone);
        setHint(identity.hint);
        setDiscoveryEnabled(identity.discoveryEnabled);
        setEditing(false);
        setPhoneInput("");
      }
    });
  }

  function removePhone() {
    startTransition(async () => {
      const result = await removePhoneNumberAction();
      report(result);
      if (result.ok) {
        setHasPhone(false);
        setHint("");
        // Removing the number necessarily ends discovery: there is nothing
        // left to be discoverable by.
        setDiscoveryEnabled(false);
        setConfirmRemove(false);
      }
    });
  }

  function toggleDiscovery(next: boolean) {
    startTransition(async () => {
      const result = await setContactDiscoveryAction(next);
      report(result);
      if (result.ok) {
        setDiscoveryEnabled(next);
        if (next) haptic("select");
      }
    });
  }

  return (
    <div className="mr-auto max-w-[680px] space-y-6 pt-6">
      <SettingsSubHeader
        title="Contact discovery"
        description="Let people who already have your number find you on Mad Buddy. Off unless you turn it on."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading your settings…
        </p>
      ) : (
        <>
          <section className="space-y-3 border-y border-border/70 py-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Phone className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Phone number</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {hasPhone
                    ? `Ending ${hint}. Your number never appears on your profile and is never shown to anyone else.`
                    : "Optional. Adding it does not put it on your profile and does not make you findable on its own."}
                </p>
              </div>
            </div>

            {editing ? (
              <div className="space-y-2 pl-12">
                <label className="block text-xs font-medium" htmlFor="contact-region">
                  Country
                </label>
                <select
                  id="contact-region"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  className="focus-ring h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
                >
                  {REGIONS.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>

                <label className="block text-xs font-medium" htmlFor="contact-phone">
                  Phone number
                </label>
                <Input
                  id="contact-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneInput}
                  maxLength={40}
                  onChange={(event) => setPhoneInput(event.target.value)}
                  placeholder="024 123 4567"
                />
                {/* Says the country picker is a convenience, not a limit. */}
                <p className="text-xs text-muted-foreground">
                  You can also type a full international number starting with +.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={savePhone} disabled={isPending || !phoneInput.trim()}>
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : null}
                    Save number
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => {
                      setEditing(false);
                      setPhoneInput("");
                      setFeedback("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pl-12">
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                  {hasPhone ? "Change number" : "Add number"}
                </Button>
                {hasPhone ? (
                  confirmRemove ? (
                    <>
                      <Button type="button" size="sm" variant="danger" disabled={isPending} onClick={removePhone}>
                        Confirm remove
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => setConfirmRemove(false)}
                      >
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemove(true)}
                      aria-label="Remove your phone number"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </Button>
                  )
                ) : null}
              </div>
            )}

            {confirmRemove ? (
              // States the scope, so nobody fears losing their account.
              <p className="pl-12 text-xs leading-5 text-muted-foreground">
                Removing your number stops contact matching. Your account, Muddies, messages and everything else stay
                exactly as they are.
              </p>
            ) : null}
          </section>

          <section className="space-y-3 border-b border-border/70 pb-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold" id="contact-discovery-label">
                  Allow people who have my number to find me
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  When this is on, someone who already has your number saved may see your profile through contact
                  matching. Your number is never shown to them.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={discoveryEnabled}
                aria-labelledby="contact-discovery-label"
                disabled={isPending || !hasPhone}
                onClick={() => toggleDiscovery(!discoveryEnabled)}
                className={cn(
                  "focus-ring relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                  discoveryEnabled ? "bg-primary" : "bg-secondary"
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none",
                    discoveryEnabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {!hasPhone ? (
              <p className="text-xs text-muted-foreground">Add a phone number first.</p>
            ) : null}
          </section>

          {feedback ? (
            <p
              role="status"
              className={cn("text-sm", isError ? "font-medium text-destructive" : "text-muted-foreground")}
            >
              {/* Errors carry weight and wording, never colour alone. */}
              {isError ? "Couldn't save: " : ""}
              {feedback}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
