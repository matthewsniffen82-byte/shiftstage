// Continue through an overall ranking, never a raw profile batch.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDiscoveryCursor(value: string | null, city: string): string {
  if (!value) return "";
  if (value.length > 300) throw new Error("Invalid discovery cursor.");
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "directory2" || parts[1] !== encodeURIComponent(city)
    || !UUID.test(parts[2]) || !/^\d+$/.test(parts[3])
    || !Number.isSafeInteger(Number(parts[3]))) throw new Error("Invalid discovery cursor.");
  return `rank1:${parts[2].toLowerCase()}:${Number(parts[3])}`;
}

export function discoveryCursor(city: string, session: string, offset: number): string {
  return `directory2:${encodeURIComponent(city)}:${session}:${offset}`;
}

export function directoryFilter(value: string | null): "all" | "now" | "not_now" {
  if (!value || value === "all") return "all";
  if (value === "now" || value === "not_now") return value;
  throw new Error("Invalid directory filter.");
}

export function directoryVenue(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!UUID.test(value)) throw new Error("Invalid directory club.");
  return value.toLowerCase();
}
