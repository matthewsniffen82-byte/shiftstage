// A request size is not a directory size: the UUID cursor has no page/count ceiling.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDiscoveryCursor(value: string | null, city: string): string | null {
  if (!value) return null;
  if (value.length > 300) throw new Error("Invalid discovery cursor.");
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "directory1" || parts[1] !== encodeURIComponent(city)
    || !UUID.test(parts[2])) throw new Error("Invalid discovery cursor.");
  return parts[2].toLowerCase();
}

export function discoveryCursor(city: string, id: string): string {
  return `directory1:${encodeURIComponent(city)}:${id}`;
}
