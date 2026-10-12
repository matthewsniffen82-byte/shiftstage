import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithServerJob } from "../server-job";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { analyzeMainPhotoHairColor } from "./hair-color-analysis";
import { HAIR_COLOR_MODEL } from "./hair-color";

type HairJob = { id: string; dancer_id: string; photo_id: string; storage_path: string; lease_token: string; attempts: number };

export async function processMainPhotoHairColors(admin: SupabaseClient) {
  return runWithServerJob(async () => {
    const { data, error } = await admin.rpc("claim_dancer_hair_color_jobs", { p_limit: 4 });
    if (error) throw error;
    const results = await Promise.all(((data || []) as HairJob[]).map(job => processJob(admin, job)));
    return { processed: results.length, failed: results.filter(result => !result).length };
  }, 50_000);
}

async function processJob(admin: SupabaseClient, job: HairJob) {
  try {
    // Never scan rejected media, an arbitrary URL, or a newer replacement at an old job's path.
    const { data: photo, error } = await admin.from("dancer_photos").select("id")
      .eq("id", job.photo_id).eq("dancer_id", job.dancer_id).eq("storage_path", job.storage_path)
      .eq("review_status", "approved").maybeSingle();
    if (error) throw error;
    if (!photo || !job.storage_path || /^https?:/i.test(job.storage_path) || job.storage_path.split("/").includes("..")) {
      await finish(admin, job, { status: "unavailable", color: "unknown", confidence: null });
      return true;
    }
    const { data: file, error: downloadError } = await admin.storage.from("dancer-photos").download(job.storage_path);
    if (downloadError) throw downloadError;
    if (!file) throw new Error("Main photo unavailable");
    const estimate = await analyzeMainPhotoHairColor(file);
    await finish(admin, job, { status: "complete", ...estimate, model: HAIR_COLOR_MODEL });
    return true;
  } catch (error) {
    console.warn("MAIN_PHOTO_HAIR_ANALYSIS_FAILED", { jobId: job.id, ...safeErrorMetadata(error) });
    await finish(admin, job, {
      status: job.attempts >= 3 ? "failed" : "pending",
      next_attempt_at: new Date(Date.now() + job.attempts * 10 * 60_000).toISOString(),
    });
    return false;
  }
}

async function finish(admin: SupabaseClient, job: HairJob, update: Record<string, unknown>) {
  // Lease comparison prevents a late worker from overwriting a reclaimed job.
  const { error } = await admin.from("dancer_photo_hair_analysis")
    .update({ ...update, locked_until: null, lease_token: null })
    .eq("id", job.id).eq("status", "processing").eq("lease_token", job.lease_token);
  if (error) throw error;
}
