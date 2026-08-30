import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  generateStoredVideoPoster,
  myDancrTvPosterStoragePath,
} from "../src/lib/dancr/media-watermark.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.argv.includes("--apply")) {
  throw new Error("Pass --apply to generate and record approved MyDancr TV posters.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const force = process.argv.includes("--force");
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rows = await loadApprovedVideos();
const totals = { generated: 0, skipped: 0, failed: 0 };

for (const row of rows) {
  const expectedPosterPath = myDancrTvPosterStoragePath(row.storage_path);
  const currentPosterPath = String(
    row.moderation_details?.posterStoragePath || "",
  ).trim();
  if (!force && currentPosterPath === expectedPosterPath) {
    totals.skipped += 1;
    continue;
  }

  try {
    const result = await generateStoredVideoPoster(admin, {
      publicBucket: "mydancr-tv-videos",
      storagePath: row.storage_path,
      storageMime: row.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
    });
    const { data: updated, error } = await admin
      .from("mydancr_tv_videos")
      .update({
        moderation_details: {
          ...(row.moderation_details || {}),
          posterStoragePath: result.posterStoragePath,
        },
      })
      .eq("id", row.id)
      .eq("status", "approved")
      .eq("storage_path", row.storage_path)
      .select("id")
      .maybeSingle();
    if (error || !updated) {
      throw error || new Error("The video changed while its poster was generated.");
    }
    totals.generated += 1;
    console.info(JSON.stringify({
      event: "mydancr_tv.poster_backfilled",
      videoId: row.id,
      bytes: result.bytes,
    }));
  } catch (error) {
    totals.failed += 1;
    console.error(JSON.stringify({
      event: "mydancr_tv.poster_backfill_failed",
      videoId: row.id,
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown poster failure",
    }));
  }
}

console.info(JSON.stringify({
  event: "mydancr_tv.poster_backfill_completed",
  videos: rows.length,
  totals,
}));
if (totals.failed) process.exitCode = 1;

async function loadApprovedVideos() {
  const pageSize = 100;
  const videos = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("mydancr_tv_videos")
      .select("id, storage_path, storage_mime, moderation_details")
      .eq("status", "approved")
      .order("published_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    videos.push(...(data || []));
    if (!data || data.length < pageSize) return videos;
  }
}
