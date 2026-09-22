export const isOndatoId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function ondatoHostedUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://idv.ondato.com" && !url.username && !url.password
      && url.pathname === "/" && !url.hash && [...url.searchParams.keys()].length === 1
      && isOndatoId(url.searchParams.get("id")) ? url.href : null;
  } catch { return null; }
}
