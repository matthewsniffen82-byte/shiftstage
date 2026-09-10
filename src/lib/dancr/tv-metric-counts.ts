import type { SupabaseClient } from "@supabase/supabase-js";

const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METRIC_BATCH_SIZE = 100;

function metricObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getManagedVideoMetricCounts(
  client: SupabaseClient,
  videoIds: string[],
  eventTypes: ReadonlySet<string>,
): Promise<Record<string, Record<string, number>>> {
  if (!Array.isArray(videoIds) || videoIds.some(id => typeof id !== "string" || !VIDEO_ID.test(id))) {
    throw new Error("Video metric selection could not be confirmed.");
  }
  const selected = [...new Set(videoIds.map(id => id.toLowerCase()))];
  const all: Record<string, Record<string, number>> = {};
  if (!selected.length) return all;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (let offset = 0; offset < selected.length; offset += METRIC_BATCH_SIZE) {
    const batch = selected.slice(offset, offset + METRIC_BATCH_SIZE);
    const { data, error } = await client.rpc("get_mydancr_tv_metric_counts", {
      p_video_ids: batch,
      p_since: since,
    });
    if (error) throw error;
    if (!metricObject(data) || Object.keys(data).length !== batch.length
      || batch.some(id => !Object.hasOwn(data, id))) {
      throw new Error("Video metrics could not be confirmed.");
    }
    for (const id of batch) {
      const totals = data[id];
      if (!metricObject(totals)) throw new Error("Video metrics could not be confirmed.");
      const metrics = Object.fromEntries([...eventTypes].map(type => [type, 0]));
      for (const [type, count] of Object.entries(totals)) {
        if (!eventTypes.has(type) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
          throw new Error("Video metrics could not be confirmed.");
        }
        metrics[type] = count;
      }
      all[id] = metrics;
    }
  }
  return all;
}
