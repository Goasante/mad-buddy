import "server-only";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const DOMAIN = "mad-buddy.com";

export type MadBuddyEmailAlias = {
  id: string;
  address: string;
  enabled: boolean;
};

type CloudflareRule = {
  id?: string;
  enabled?: boolean;
  matchers?: Array<{ type?: string; field?: string; value?: string }>;
  actions?: Array<{ type?: string; value?: string[] }>;
  name?: string;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

export function cloudflareAliasConfigStatus() {
  const token = process.env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN?.trim() ?? "";
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim() ?? "";
  const forwardTo = process.env.CLOUDFLARE_EMAIL_FORWARD_TO?.trim() ?? "";
  return {
    configured: Boolean(token && zoneId && forwardTo),
    hasToken: Boolean(token),
    hasZoneId: Boolean(zoneId),
    hasForwardTo: Boolean(forwardTo)
  };
}

export async function listMadBuddyEmailAliases(): Promise<MadBuddyEmailAlias[]> {
  const config = requireConfig();
  const envelope = await cloudflareRequest<CloudflareRule[]>(
    `/zones/${config.zoneId}/email/routing/rules`,
    { method: "GET" },
    config.token
  );

  return (envelope.result ?? [])
    .map(toAlias)
    .filter((alias): alias is MadBuddyEmailAlias => Boolean(alias))
    .sort((a, b) => a.address.localeCompare(b.address));
}

export async function createMadBuddyEmailAlias(localPart: string): Promise<MadBuddyEmailAlias> {
  const config = requireConfig();
  const normalized = normalizeLocalPart(localPart);
  if (!normalized) throw new Error("invalid_alias");
  const address = `${normalized}@${DOMAIN}`;

  const existing = await listMadBuddyEmailAliases();
  if (existing.some((alias) => alias.address.toLowerCase() === address.toLowerCase())) {
    throw new Error("alias_exists");
  }

  const envelope = await cloudflareRequest<CloudflareRule>(
    `/zones/${config.zoneId}/email/routing/rules`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Mad Buddy alias: ${address}`,
        enabled: true,
        source: "api",
        matchers: [{ type: "literal", field: "to", value: address }],
        actions: [{ type: "forward", value: [config.forwardTo] }]
      })
    },
    config.token
  );

  const alias = envelope.result ? toAlias(envelope.result) : null;
  if (!alias) throw new Error("alias_create_failed");
  return alias;
}

export async function deleteMadBuddyEmailAlias(ruleId: string) {
  const config = requireConfig();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(ruleId)) throw new Error("invalid_rule");

  const current = await cloudflareRequest<CloudflareRule>(
    `/zones/${config.zoneId}/email/routing/rules/${encodeURIComponent(ruleId)}`,
    { method: "GET" },
    config.token
  );
  const alias = current.result ? toAlias(current.result) : null;
  if (!alias) throw new Error("rule_not_managed_alias");

  await cloudflareRequest<CloudflareRule>(
    `/zones/${config.zoneId}/email/routing/rules/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" },
    config.token
  );
}

function requireConfig() {
  const token = process.env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN?.trim();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
  const forwardTo = process.env.CLOUDFLARE_EMAIL_FORWARD_TO?.trim();
  if (!token || !zoneId || !forwardTo) throw new Error("cloudflare_aliases_not_configured");
  return { token, zoneId, forwardTo };
}

function normalizeLocalPart(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 64) return null;
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

function toAlias(rule: CloudflareRule): MadBuddyEmailAlias | null {
  if (!rule.id) return null;
  const matcher = rule.matchers?.find(
    (item) => item.type === "literal" && item.field === "to" && typeof item.value === "string"
  );
  const address = matcher?.value?.trim().toLowerCase();
  if (!address || !address.endsWith(`@${DOMAIN}`)) return null;
  const hasForward = rule.actions?.some((action) => action.type === "forward");
  if (!hasForward) return null;
  return { id: rule.id, address, enabled: rule.enabled !== false };
}

async function cloudflareRequest<T>(path: string, init: RequestInit, token: string): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  const envelope = (await response.json().catch(() => ({}))) as CloudflareEnvelope<T>;
  if (!response.ok || envelope.success === false) {
    const message = envelope.errors?.map((error) => error.message).filter(Boolean).join("; ") || `cloudflare_http_${response.status}`;
    throw new Error(message);
  }
  return envelope;
}
