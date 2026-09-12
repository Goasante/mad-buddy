"use client";

import { useEffect, useState } from "react";
import type { AvatarSourceHook } from "@/components/app-shell/app-header";

/**
 * Web's avatar source resolution, injected into the shared header.
 *
 * Two behaviours live here that the raw `currentAvatarUrl` does not provide,
 * and both were briefly lost when the header became shared:
 *
 * 1. A Mad Buddy upload is served through `/api/profile/avatar`, the canonical
 *    current-user endpoint. The layout's profile snapshot can lag a save, so
 *    reading the stored URL alone shows the previous photo.
 * 2. `madbuddy:avatar-updated` fires when a new photo is saved. Without
 *    listening, the header keeps the old image until some other navigation
 *    happens to refresh the layout.
 *
 * The revision doubles as a cache-buster: the endpoint URL is otherwise
 * identical between the old and new photo, so a browser would serve the stale
 * one from cache.
 *
 * This is deliberately NOT in the shared header. `/api/profile/avatar` is a
 * web route, and the Capacitor app's avatar URL is already canonical, so
 * mobile passes nothing and uses the value directly.
 */
export const useWebAvatarSource: AvatarSourceHook = (src) => {
  const [avatarRevision, setAvatarRevision] = useState(0);

  useEffect(() => {
    const handleAvatarUpdate = () => setAvatarRevision(Date.now());
    window.addEventListener("madbuddy:avatar-updated", handleAvatarUpdate);
    return () => window.removeEventListener("madbuddy:avatar-updated", handleAvatarUpdate);
  }, []);

  // A provider avatar (Google, etc.) is not stored in our bucket, so it is
  // used as-is -- until an update fires, at which point the person has
  // uploaded their own and the endpoint becomes authoritative.
  const isExternalAvatar = Boolean(src && !src.includes("/storage/v1/object/"));

  return isExternalAvatar && avatarRevision === 0
    ? src
    : `/api/profile/avatar${avatarRevision ? `?v=${avatarRevision}` : ""}`;
};
