/** Preserve existing row positions and any open drafts; append new arrivals. */
export function mergeLiveRows<T extends { id?: unknown }>(current: T[], incoming: T[], protectedIds: ReadonlySet<string> = new Set()): T[] {
  const fresh = new Map(incoming.map(row => [String(row.id), row]));
  const result: T[] = [];
  for (const row of current) {
    const id = String(row.id), update = fresh.get(id);
    if (protectedIds.has(id)) result.push(row);
    else if (update) result.push(update);
    fresh.delete(id);
  }
  return [...result, ...fresh.values()];
}
