// Exact provider hosts, including Veriff's documented domain migration.
const hostedHosts = new Set(["saas.veriff.com", "eu.veriff.com", "us.veriff.com", "alchemy.veriff.com", "magic.veriff.me", "magic.us.veriff.me"]);
const apiHosts = new Set(["api-saas.veriff.com", "api-eu.veriff.com", "api-us.veriff.com", "stationapi.veriff.com", "api.veriff.me", "api.us.veriff.me"]);

function providerUrl(value: unknown, hosts: Set<string>): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.has(url.hostname) && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

export function veriffHostedUrl(value: unknown): string | null {
  const url = providerUrl(value, hostedHosts);
  return url && url.pathname.startsWith("/v/") && url.pathname.length > 3 && !url.hash ? url.href : null;
}

export function veriffApiUrl(value: unknown): string | null {
  const url = providerUrl(value, apiHosts);
  return url && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
}
