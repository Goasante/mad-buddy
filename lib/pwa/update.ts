export const PWA_UPDATE_ATTEMPT_KEY = "mad-buddy:pwa-update-attempt";
export const PWA_UPDATE_ATTEMPT_COOLDOWN_MS = 5 * 60 * 1000;

const BUILD_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,160}$/;

export function normalizeBuildId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return BUILD_ID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveBuildId(env: Record<string, string | undefined>) {
  return (
    normalizeBuildId(env.VERCEL_DEPLOYMENT_ID) ??
    normalizeBuildId(env.VERCEL_GIT_COMMIT_SHA) ??
    normalizeBuildId(env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) ??
    normalizeBuildId(env.NEXT_PUBLIC_APP_VERSION) ??
    "development"
  );
}

export function serviceWorkerUrlForBuild(buildId: string) {
  const params = new URLSearchParams({ build: normalizeBuildId(buildId) ?? "development" });
  return `/sw.js?${params.toString()}`;
}

export type UpdateAttempt = {
  buildId: string;
  attemptedAt: number;
};

export function parseUpdateAttempt(value: string | null): UpdateAttempt | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<UpdateAttempt>;
    const buildId = normalizeBuildId(parsed.buildId);
    if (
      !buildId ||
      typeof parsed.attemptedAt !== "number" ||
      !Number.isFinite(parsed.attemptedAt) ||
      parsed.attemptedAt <= 0
    ) {
      return null;
    }
    return { buildId, attemptedAt: parsed.attemptedAt };
  } catch {
    return null;
  }
}

export function serializeUpdateAttempt(attempt: UpdateAttempt) {
  return JSON.stringify(attempt);
}

export function shouldOfferBuildUpdate(input: {
  currentBuildId: string;
  latestBuildId: string | null;
  previousAttempt: UpdateAttempt | null;
  now?: number;
}) {
  if (!input.latestBuildId || input.latestBuildId === input.currentBuildId) {
    return false;
  }
  if (
    input.previousAttempt?.buildId === input.latestBuildId &&
    (input.now ?? Date.now()) - input.previousAttempt.attemptedAt <
      PWA_UPDATE_ATTEMPT_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

export function shouldReloadForControllerChange(input: {
  updateRequested: boolean;
  reloadTriggered: boolean;
}) {
  return input.updateRequested && !input.reloadTriggered;
}
