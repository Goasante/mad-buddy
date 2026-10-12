import "server-only";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type MutationRequestValidation = {
  ok: boolean;
  transport: "safe_method" | "bearer" | "cookie";
  reason?: "cross_site" | "untrusted_origin" | "missing_origin_evidence";
};

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function trustedOrigins(request: Request): Set<string> {
  const trusted = new Set<string>();
  const requestOrigin = normalizedOrigin(request.url);
  if (requestOrigin) trusted.add(requestOrigin);

  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) {
    const protocol =
      request.headers.get("x-forwarded-proto") ??
      (requestOrigin ? new URL(requestOrigin).protocol.replace(":", "") : "https");
    const forwardedOrigin = normalizedOrigin(`${protocol}://${forwardedHost}`);
    if (forwardedOrigin) trusted.add(forwardedOrigin);
  }

  const configuredOrigin = normalizedOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configuredOrigin) trusted.add(configuredOrigin);
  return trusted;
}

function hasBearerToken(request: Request): boolean {
  return request.headers.get("authorization")?.toLowerCase().startsWith("bearer ") ?? false;
}

/**
 * CSRF applies to ambient cookie authentication, not explicit mobile Bearer
 * credentials. Same-origin Origin/Referer evidence is preferred; Fetch
 * Metadata is a safe fallback for service-worker requests that omit both.
 */
export function validateMutationRequest(request: Request): MutationRequestValidation {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true, transport: "safe_method" };
  if (hasBearerToken(request)) return { ok: true, transport: "bearer" };

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return { ok: false, transport: "cookie", reason: "cross_site" };
  }

  const trusted = trustedOrigins(request);
  const origin = normalizedOrigin(request.headers.get("origin"));
  if (origin) {
    return trusted.has(origin)
      ? { ok: true, transport: "cookie" }
      : { ok: false, transport: "cookie", reason: "untrusted_origin" };
  }

  const referer = normalizedOrigin(request.headers.get("referer"));
  if (referer) {
    return trusted.has(referer)
      ? { ok: true, transport: "cookie" }
      : { ok: false, transport: "cookie", reason: "untrusted_origin" };
  }

  if (fetchSite === "same-origin" || fetchSite === "none") {
    return { ok: true, transport: "cookie" };
  }

  return { ok: false, transport: "cookie", reason: "missing_origin_evidence" };
}

export function invalidMutationOriginResponse(request: Request): Response | null {
  const validation = validateMutationRequest(request);
  if (validation.ok) return null;
  return Response.json({ error: "Invalid request origin." }, { status: 403 });
}
