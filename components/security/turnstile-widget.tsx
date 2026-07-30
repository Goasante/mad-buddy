"use client";

import { useEffect, useId, useRef, useState } from "react";

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  theme: "auto";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({
  siteKey,
  action,
  onTokenChange,
  resetKey = 0
}: {
  siteKey: string;
  action: "signup" | "password_recovery";
  onTokenChange: (token: string | null) => void;
  resetKey?: number;
}) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!siteKey) {
      onTokenChange(null);
      return;
    }

    let cancelled = false;
    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "auto",
        callback: (token) => {
          setError("");
          onTokenChange(token);
        },
        "expired-callback": () => {
          onTokenChange(null);
          setError("The security check expired. Complete it again.");
        },
        "error-callback": () => {
          onTokenChange(null);
          setError("The security check could not load. Check your connection and try again.");
        }
      });
    };

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (window.turnstile) {
      renderWidget();
    } else if (existingScript) {
      existingScript.addEventListener("load", renderWidget);
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", renderWidget);
      script.addEventListener("error", () => {
        if (!cancelled) setError("The security check could not load. Check your connection and try again.");
      });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      existingScript?.removeEventListener("load", renderWidget);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      onTokenChange(null);
    };
  }, [action, onTokenChange, resetKey, siteKey]);

  if (!siteKey) return null;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        id={`turnstile-${reactId.replace(/:/g, "")}`}
        aria-label="Security verification"
        className="min-h-[65px] overflow-hidden rounded-xl"
      />
      {error ? (
        <p className="text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
