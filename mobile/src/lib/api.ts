import { env } from "./env";
import { getAccessToken } from "./supabase";

export type ApiResult<T = { ok: boolean; message: string }> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

/**
 * Calls a web-app /api/* route handler with the current user's bearer token.
 * The route resolves the token via resolveApiUser (dual auth) and applies the
 * same RLS + service-role logic the web Server Actions use.
 */
async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<ApiResult<T>> {
  const { auth = true, headers, ...rest } = init;

  const finalHeaders = new Headers(headers);
  if (rest.body && !finalHeaders.has("content-type")) {
    finalHeaders.set("content-type", "application/json");
  }
  if (auth) {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: "You are signed out.", status: 401 };
    finalHeaders.set("authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, { ...rest, headers: finalHeaders });
  } catch {
    return { ok: false, error: "Network error. Check your connection.", status: 0 };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : undefined) ??
      (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : undefined) ??
      "Something went wrong.";
    return { ok: false, error: message, status: response.status };
  }

  return { ok: true, data: (payload ?? {}) as T };
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown, opts: { auth?: boolean } = {}) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, auth: opts.auth }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined })
};
