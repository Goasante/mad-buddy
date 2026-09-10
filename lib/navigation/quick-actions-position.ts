/**
 * The floating Quick Actions launcher remembers where the user dragged it,
 * per device/browser. Only an EDGE (left or right) and a vertical fraction of
 * the safe viewport are stored -- never a raw pixel coordinate -- so a stored
 * position is meaningless on its own and must always be resolved against the
 * CURRENT viewport by resolvePosition() before use. That is what keeps a
 * position saved on a tall phone from landing off-screen on a short one, or
 * behind the keyboard, or under the bottom navigation after a layout change.
 */

export type QuickActionsEdge = "left" | "right";

export type QuickActionsPosition = {
  edge: QuickActionsEdge;
  /** 0 (top of the safe band) to 1 (bottom of the safe band). */
  verticalFraction: number;
};

const STORAGE_KEY = "mad-buddy-quick-actions-position";

function isEdge(value: unknown): value is QuickActionsEdge {
  return value === "left" || value === "right";
}

function clampFraction(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** Reads the stored position. Never throws: a private window or a cleared
 * store should fall back to the default, not break the launcher. */
export function loadQuickActionsPosition(): QuickActionsPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { edge?: unknown; verticalFraction?: unknown };
    if (!isEdge(parsed.edge)) return null;
    return { edge: parsed.edge, verticalFraction: clampFraction(parsed.verticalFraction) };
  } catch {
    return null;
  }
}

export function saveQuickActionsPosition(position: QuickActionsPosition): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ edge: position.edge, verticalFraction: clampFraction(position.verticalFraction) })
    );
  } catch {
    // Storage can throw in private/locked-down contexts. The launcher still
    // works at its default position; it simply will not remember next time.
  }
}
