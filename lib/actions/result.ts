/**
 * What an action says when it fails.
 *
 * THE FAILURE THIS EXISTS FOR. Every authenticated screen sits under one error
 * boundary, `app/(app)/error.tsx`, which renders "This page could not be
 * opened". Anything that throws lands there -- so an invalid username, a
 * missing field, a failed upload and a real outage all produced the same dead
 * end, in unrelated features, with no way back. A missing field is not a
 * missing page.
 *
 * So ordinary failures are DATA, not exceptions. Actions already return
 * `{ ok, message }` across this codebase; this widens that shape rather than
 * replacing it, because a parallel result type would leave two conventions and
 * the older one is in ~200 places.
 *
 * `code` is what the UI switches on. `message` is what the person reads, and
 * stays the authority for wording -- the server has the context to say
 * something specific, and a client that re-derives copy from `code` alone will
 * drift from it.
 */

/**
 * Why an action failed, at the granularity the UI actually needs.
 *
 * Deliberately small. Each entry exists because it deserves a DIFFERENT
 * response from the interface, not because it names a different internal
 * cause: VALIDATION_ERROR focuses a field, RATE_LIMITED offers waiting,
 * NETWORK_ERROR offers retry. Splitting further would produce codes nothing
 * branches on.
 */
export type ActionErrorCode =
  /** A value the person can correct. Focus the field, keep everything typed. */
  | "VALIDATION_ERROR"
  /** The resource genuinely does not exist -- or is concealed as absent. */
  | "NOT_FOUND"
  /** Real, and sometimes deliberately reported as NOT_FOUND instead. */
  | "PERMISSION_DENIED"
  /** Temporary and self-clearing; say when, never just "try again". */
  | "RATE_LIMITED"
  /** The file did not make it. The rest of the batch is unaffected. */
  | "UPLOAD_FAILED"
  /** The request never arrived. Retrying is the right offer. */
  | "NETWORK_ERROR"
  /** A dependency is down. Not the person's fault and not their problem to fix. */
  | "UNAVAILABLE"
  /** Everything else. The only code that may be reported as a page-level error. */
  | "SERVER_ERROR";

/**
 * The result of an action that can fail in a way the person can act on.
 *
 * Every field past `ok` is optional so an existing `{ ok, message }` return is
 * already a valid ActionResult and can be widened where it helps, one action at
 * a time, instead of in a single sweep.
 */
export type ActionResult<T = unknown> = {
  ok: boolean;
  /** What the person reads. The server owns this wording. */
  message?: string;
  /** What the UI branches on. Absent on success. */
  code?: ActionErrorCode;
  /** Which input to focus, for VALIDATION_ERROR. */
  field?: string;
  /** Where to go NEXT, and only after ok === true. Never a raw user value. */
  redirectTo?: string;
  /** Whatever the caller needs on success. */
  data?: T;
};

/** True when the failure is worth offering a retry for. */
export function isRetryable(code: ActionErrorCode | undefined): boolean {
  return code === "NETWORK_ERROR" || code === "UNAVAILABLE" || code === "RATE_LIMITED";
}

/**
 * Whether a failure justifies the full-page error state.
 *
 * Only SERVER_ERROR does, and even then only when there is no surface left to
 * show a message in. This is the guard that keeps §3 true: the page-level dead
 * end is the last resort, not the default.
 */
export function isPageLevelFailure(code: ActionErrorCode | undefined): boolean {
  return code === "SERVER_ERROR";
}

/** A failure, stated so the UI has both a code to branch on and words to show. */
export function fail(code: ActionErrorCode, message: string, field?: string): ActionResult<never> {
  return { ok: false, code, message, ...(field ? { field } : {}) };
}

/** A success, optionally carrying data and a destination. */
export function succeed<T>(data?: T, message?: string, redirectTo?: string): ActionResult<T> {
  return {
    ok: true,
    ...(data === undefined ? {} : { data }),
    ...(message ? { message } : {}),
    ...(redirectTo ? { redirectTo } : {})
  };
}
