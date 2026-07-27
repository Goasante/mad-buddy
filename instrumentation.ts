export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }

  const [{ readVapidConfiguration }, { logBackendEvent }] = await Promise.all([
    import("@/lib/notifications/vapid"),
    import("@/lib/observability/logger")
  ]);
  const configuration = readVapidConfiguration(process.env);
  if (configuration.ok) return;

  logBackendEvent("error", {
    action: "startup.web_push_configuration",
    statusCode: 503,
    errorType: configuration.mismatch
      ? "vapid_public_key_mismatch"
      : `missing_vapid_configuration:${configuration.missing.join(",")}`
  });
}
