/** Future-intent UpFors can become upcoming cards; Now keeps only its Plan/chat. */
export function shouldShowConvertedUpForOnHome(source: { starts_at: string; created_at: string } | null): boolean {
  if (!source) return false;
  const start = Date.parse(source.starts_at);
  const created = Date.parse(source.created_at);
  return Number.isFinite(start) && Number.isFinite(created) && start > created;
}
