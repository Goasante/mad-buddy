export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type TimeoutOptions = {
  operation: string;
  timeoutMs?: number;
  slowAfterMs?: number;
};

export class RequestTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError;
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  {
    operation,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    slowAfterMs = 4_000,
  }: TimeoutOptions,
): Promise<T> {
  const startedAt = now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // Set only by the timeout branch below, so the `finally` block can tell a
  // request that actually finished (however slowly) apart from one this
  // function gave up on and aborted. Without this, both were logged under
  // the identical "slow operation" label -- which is what turned a genuinely
  // unresponsive server (every request hitting its 12-15s ceiling) into a
  // console full of entries that read as "slow" rather than "not answering",
  // and sent debugging toward the wrong layer.
  let timedOut = false;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new RequestTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const durationMs = Math.round(now() - startedAt);
    if (process.env.NODE_ENV !== "test") {
      if (timedOut) {
        console.warn("[performance] operation timed out", { operation, durationMs });
      } else if (durationMs >= slowAfterMs) {
        console.warn("[performance] slow operation", { operation, durationMs });
      }
    }
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  operation = "network request",
) {
  const controller = new AbortController();
  const callerSignal = init.signal;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  // Distinguishes "this fetch aborted because OUR timer fired" from every
  // other reason a fetch can reject (the caller's own signal, a genuine
  // network error) so the finally block below can log accordingly -- see the
  // matching note in withTimeout above for why this distinction matters.
  let timedOut = false;

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      timedOut = true;
      throw new RequestTimeoutError(operation, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);

    const durationMs = Math.round(now() - startedAt);
    if (process.env.NODE_ENV !== "test") {
      if (timedOut) {
        console.warn("[performance] operation timed out", { operation, durationMs });
      } else if (durationMs >= 4_000) {
        console.warn("[performance] slow operation", { operation, durationMs });
      }
    }
  }
}
