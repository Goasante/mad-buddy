"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Download, Menu, Plus, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/use-pwa-install";

export function InstallAppPrompt() {
  const { device, visible, nativePromptAvailable, installing, installed, dismiss, install } = usePWAInstall();
  if (installed || device.platform === "unsupported" || device.platform === "desktop") return null;

  const isAndroid = device.platform === "android";
  const needsSafari = device.platform === "ios" && device.iosBrowser === "other";
  const nativeAndroidInstall = isAndroid && nativePromptAvailable;

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => !open && dismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="install-prompt-overlay fixed inset-0 z-[95] bg-black/20 backdrop-blur-[1px]" />
        <Dialog.Content
          className="install-prompt-panel fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[96] mx-auto w-auto max-w-[420px] rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-[0_20px_70px_hsl(var(--shadow)/0.32)] outline-none sm:inset-x-auto sm:right-5 sm:mx-0 sm:w-[400px]"
          aria-describedby="install-app-description"
        >
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/pwa/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="pr-7 text-base font-semibold leading-6">Add Mad Buddy to your Home Screen</Dialog.Title>
              <Dialog.Description id="install-app-description" className="mt-0.5 text-sm leading-5 text-muted-foreground">
                Open Mad Buddy like an app with one tap.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="focus-ring safe-motion -mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Close install prompt"
                title="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {nativeAndroidInstall ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-secondary/60 p-3 text-sm">
              <Download className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>The browser will confirm installation and add the Mad Buddy icon.</p>
            </div>
          ) : needsSafari ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-secondary/60 p-3 text-sm leading-5">
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>Open this page in Safari to add Mad Buddy to your Home Screen.</p>
            </div>
          ) : (
            <ol className="mt-4 grid gap-2" aria-label={isAndroid ? "Android installation steps" : "iPhone and iPad installation steps"}>
              {(isAndroid ? androidSteps : iosSteps).map((step, index) => (
                <li key={step.label} className="flex min-h-10 items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                  <step.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={dismiss}>Not now</Button>
            {nativeAndroidInstall ? (
              <Button type="button" disabled={installing} onClick={() => void install()}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {installing ? "Opening..." : "Add to Home Screen"}
              </Button>
            ) : (
              <Button type="button" onClick={dismiss}>Got it</Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const androidSteps = [
  { icon: Menu, label: "Tap the browser menu" },
  { icon: SquarePlus, label: "Choose Add to Home screen or Install app" },
  { icon: Check, label: "Confirm Install" }
];

const iosSteps = [
  { icon: Share, label: "Tap the Share icon" },
  { icon: Plus, label: "Select Add to Home Screen" },
  { icon: Check, label: "Tap Add" }
];
