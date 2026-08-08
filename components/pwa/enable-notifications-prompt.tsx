"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Bell,
  CalendarDays,
  Check,
  Hand,
  MapPinCheck,
  MessageCircle,
  PartyPopper,
  Smartphone,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { useBrowserPush } from "@/hooks/use-browser-push";
import {
  NOTIFICATION_ONBOARDING_COMPLETED_PREFIX,
  NOTIFICATION_ONBOARDING_DISMISSED_PREFIX,
  NOTIFICATION_ONBOARDING_SHOWN_PREFIX,
  notificationOnboardingStorageKey,
  shouldOfferNotificationOnboarding
} from "@/lib/notifications/onboarding";
import {
  detectDevicePlatform,
  isStandaloneDisplay,
  type DevicePlatform
} from "@/lib/pwa/install";

type PromptPhase = "benefits" | "denied" | "success";
type NavigatorWithStandalone = Navigator & { standalone?: boolean };

const INITIAL_DEVICE: DevicePlatform = {
  platform: "unsupported",
  iosBrowser: null,
  isWebView: false
};

const androidBenefits = [
  { icon: MessageCircle, label: "New messages" },
  { icon: UsersRound, label: "UpFor requests" },
  { icon: Hand, label: "Waves from Muddies" },
  { icon: MapPinCheck, label: "Safe Arrival updates" },
  { icon: PartyPopper, label: "Achievements" },
  { icon: CalendarDays, label: "Plans and reminders" }
];

const iosBenefits = [
  { icon: MessageCircle, label: "Messages" },
  { icon: UsersRound, label: "UpFor requests" },
  { icon: MapPinCheck, label: "Safe Arrival" },
  { icon: PartyPopper, label: "Achievements" },
  { icon: CalendarDays, label: "Plans" }
];

export function EnableNotificationsPrompt({ userId }: { userId: string }) {
  const { status, feedback, isPending, enable } = useBrowserPush();
  const [device, setDevice] = useState<DevicePlatform>(INITIAL_DEVICE);
  const [installedOrJustInstalled, setInstalledOrJustInstalled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<PromptPhase>("benefits");

  const dismissedKey = useMemo(
    () =>
      notificationOnboardingStorageKey(
        NOTIFICATION_ONBOARDING_DISMISSED_PREFIX,
        userId
      ),
    [userId]
  );
  const completedKey = useMemo(
    () =>
      notificationOnboardingStorageKey(
        NOTIFICATION_ONBOARDING_COMPLETED_PREFIX,
        userId
      ),
    [userId]
  );
  const shownKey = useMemo(
    () =>
      notificationOnboardingStorageKey(
        NOTIFICATION_ONBOARDING_SHOWN_PREFIX,
        userId
      ),
    [userId]
  );

  useEffect(() => {
    const detected = detectDevicePlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints
    });
    const standalone = isStandaloneDisplay({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as NavigatorWithStandalone).standalone
    });
    const frame = window.requestAnimationFrame(() => {
      setDevice(detected);
      setInstalledOrJustInstalled(standalone);
    });

    const handleInstalled = () => setInstalledOrJustInstalled(true);
    window.addEventListener("mad-buddy:pwa-installed", handleInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mad-buddy:pwa-installed", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (status === "checking") return;
    const permission =
      "Notification" in window ? Notification.permission : "unsupported";
    const eligible = shouldOfferNotificationOnboarding({
      authenticated: Boolean(userId),
      device,
      installedOrJustInstalled,
      permission,
      pushConfigured: status === "on",
      completed: window.localStorage.getItem(completedKey) === "true",
      dismissedAt: window.localStorage.getItem(dismissedKey),
      shownThisSession: window.sessionStorage.getItem(shownKey) === "true"
    });
    if (!eligible) return;

    const timer = window.setTimeout(() => {
      setPhase(permission === "denied" ? "denied" : "benefits");
      window.sessionStorage.setItem(shownKey, "true");
      setVisible(true);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [
    completedKey,
    device,
    dismissedKey,
    installedOrJustInstalled,
    shownKey,
    status,
    userId
  ]);

  function dismiss() {
    window.localStorage.setItem(dismissedKey, String(Date.now()));
    setVisible(false);
  }

  function requestPermission() {
    enable((result) => {
      if (result.ok) {
        window.localStorage.setItem(completedKey, "true");
        setPhase("success");
        return;
      }
      if (result.permission === "denied") {
        setPhase("denied");
      }
    });
  }

  const isIOS = device.platform === "ios";
  const benefits = isIOS ? iosBenefits : androidBenefits;

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(open) => {
        if (!open && phase !== "success") dismiss();
        else setVisible(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="notification-opt-in-overlay fixed inset-0 z-[98] bg-black/55 backdrop-blur-sm" />
        <Dialog.Content
          className="notification-opt-in-panel fixed left-1/2 top-1/2 z-[99] max-h-[min(92dvh,720px)] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border/80 bg-card p-5 text-card-foreground shadow-[0_28px_90px_hsl(var(--shadow)/0.45)] outline-none sm:p-6"
          aria-describedby="notification-opt-in-description"
        >
          {phase === "success" ? (
            <SuccessStep onContinue={() => setVisible(false)} />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Dialog.Title className="text-2xl font-semibold tracking-tight">
                    Stay Connected
                  </Dialog.Title>
                  <Dialog.Description
                    id="notification-opt-in-description"
                    className="mt-1 text-sm text-muted-foreground"
                  >
                    {isIOS
                      ? "Turn on notifications for Mad Buddy."
                      : "Never miss what matters."}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="focus-ring safe-motion -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Close notification setup"
                    title="Close"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>

              <PhoneIllustration isIOS={isIOS} />

              {phase === "denied" ? (
                <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                  <p className="font-semibold">Notifications are currently off</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {isIOS
                      ? "You can enable them from Settings, Notifications, Mad Buddy."
                      : "You can enable them from your device or browser notification settings for Mad Buddy."}
                  </p>
                </div>
              ) : (
                <>
                  <p className="mt-5 text-sm font-medium">
                    {isIOS ? "You’ll receive updates about:" : "Receive instant alerts for:"}
                  </p>
                  <ul className="mt-3 grid grid-cols-2 gap-2" aria-label="Notification benefits">
                    {benefits.map(({ icon: Icon, label }) => (
                      <li
                        key={label}
                        className="flex min-h-11 items-center gap-2 rounded-xl bg-secondary/55 px-3 py-2 text-sm"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Mad Buddy only sends notifications you&apos;ve chosen to receive. You
                can change this anytime.
              </p>
              {status === "error" && feedback ? (
                <p
                  className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {feedback}
                </p>
              ) : null}

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {phase === "denied" ? (
                  <Button type="button" className="sm:col-span-2" onClick={dismiss}>
                    Got it
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      className="sm:order-2"
                      disabled={isPending}
                      onClick={requestPermission}
                    >
                      <Bell className="h-4 w-4" aria-hidden="true" />
                      {isPending ? "Enabling..." : "Enable Notifications"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={dismiss}>
                      Not Now
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PhoneIllustration({ isIOS }: { isIOS: boolean }) {
  return (
    <div
      className="relative mx-auto mt-5 h-44 w-full overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_35%,hsl(var(--primary)/0.18),transparent_58%)]"
      aria-hidden="true"
    >
      <div
        className={`absolute left-1/2 top-3 h-40 w-24 -translate-x-1/2 rounded-[1.8rem] border-2 border-foreground/20 bg-background p-1.5 shadow-xl ${
          isIOS ? "ring-1 ring-foreground/10" : ""
        }`}
      >
        <div className="relative h-full overflow-hidden rounded-[1.35rem] bg-secondary">
          <div
            className={`mx-auto mt-1.5 bg-foreground/70 ${
              isIOS ? "h-2.5 w-10 rounded-full" : "h-1.5 w-1.5 rounded-full"
            }`}
          />
          <div className="mx-2 mt-5 rounded-lg border border-border bg-card/95 p-2 shadow-lg">
            <div className="flex items-center gap-2">
              <BrandMark className="h-6 w-6 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[8px] font-semibold">Mad Buddy</p>
                <p className="mt-0.5 text-[7px] leading-tight text-muted-foreground">
                  You have a new update.
                </p>
              </div>
            </div>
          </div>
          {!isIOS ? (
            <div className="mx-2 mt-2 space-y-1.5 opacity-55">
              <span className="block h-1.5 rounded-full bg-foreground/20" />
              <span className="block h-1.5 w-4/5 rounded-full bg-foreground/15" />
            </div>
          ) : null}
        </div>
      </div>
      <Smartphone className="absolute bottom-5 right-7 h-5 w-5 text-primary/70" />
    </div>
  );
}

function SuccessStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="py-4 text-center">
      <div className="relative mx-auto grid h-24 w-24 place-items-center">
        <span className="notification-success-ring absolute inset-0 rounded-full border border-emerald-400/50" />
        <span className="notification-bell-success grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
          <Bell className="h-7 w-7" aria-hidden="true" />
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 grid h-8 w-8 place-items-center rounded-full border-4 border-card bg-emerald-500 text-white">
          <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
        </span>
      </div>
      <Dialog.Title className="mt-5 text-2xl font-semibold tracking-tight">
        You&apos;re All Set!
      </Dialog.Title>
      <Dialog.Description
        id="notification-opt-in-description"
        className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground"
      >
        We&apos;ll only notify you about activity that matters to you.
      </Dialog.Description>
      <Button type="button" className="mt-6 w-full" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}
