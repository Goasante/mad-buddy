const PLACEHOLDER_PREFIX = "new_muddy_";

export function createPlaceholderUsername(userId: string): string {
  const suffix = userId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
  return `${PLACEHOLDER_PREFIX}${suffix}`;
}

export function isPlaceholderUsername(username: string | null | undefined): boolean {
  return Boolean(username?.startsWith(PLACEHOLDER_PREFIX));
}

export const PLACEHOLDER_DISPLAY_NAME = "New Muddy";
