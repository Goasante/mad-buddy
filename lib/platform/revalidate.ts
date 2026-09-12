"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * The data-refresh contract — web implementation.
 *
 * "I just mutated server state; re-read what this screen shows."
 *
 * On web that is exactly router.refresh(): re-run the Server Component tree
 * and re-stream fresh props. The optional `reload` argument is ignored here,
 * because the server tree is already the source of truth.
 *
 * On mobile there is no server tree, so the mobile implementation runs the
 * `reload` the screen passes in. Expressing this as one named contract — used
 * by both platforms — is what lets a shared component say what it MEANS
 * ("re-read my data") rather than naming a mechanism only one platform has.
 *
 * Migration note: the 57 existing `router.refresh()` call sites should move to
 * this hook. On web that is a pure alias, so each move is behaviour-preserving
 * and verifiable by diffing build output.
 */
export function useRevalidate(_reload?: () => void | Promise<void>): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.refresh();
  }, [router]);
}
