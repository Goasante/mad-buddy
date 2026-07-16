import "server-only";

import { createHash, randomUUID } from "crypto";

type LogLevel = "info" | "warn" | "error";

type SafeLogFields = {
  requestId?: string;
  route?: string;
  action?: string;
  statusCode?: number;
  latencyMs?: number;
  userId?: string | null;
  errorType?: string;
  rateLimited?: boolean;
};

const forbiddenKeys = new Set([
  "latitude",
  "longitude",
  "accuracy",
  "distance",
  "geohash",
  "token",
  "secret",
  "paymentSecret",
  "accessToken"
]);

export function createRequestId() {
  return randomUUID();
}

export function hashLogSubject(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function logBackendEvent(level: LogLevel, event: SafeLogFields) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    requestId: event.requestId,
    route: event.route,
    action: event.action,
    statusCode: event.statusCode,
    latencyMs: event.latencyMs,
    userIdHash: hashLogSubject(event.userId),
    errorType: event.errorType,
    rateLimited: event.rateLimited
  };

  for (const key of forbiddenKeys) {
    delete payload[key];
  }

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function errorType(error: unknown) {
  if (error instanceof Error) {
    return error.name;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return `PostgrestError:${error.code}`;
  }

  return "UnknownError";
}
