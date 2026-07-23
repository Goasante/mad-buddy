"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";

export default function CapacitorBackButton() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let remove: (() => void) | undefined;
    void App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) {
        router.back();
      } else {
        void App.exitApp();
      }
    }).then((handle) => {
      remove = () => void handle.remove();
    });

    return () => remove?.();
  }, [router]);

  return null;
}