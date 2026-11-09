import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { processRetentionMedia } from "./retention-storage.mjs";
export { retentionObjectFamily, processRetentionMedia } from "./retention-storage.mjs";

export const RECOVERY_BUCKET = "retention-recovery";
export async function drainRetentionMedia(db: SupabaseClient) {
  const deadline = performance.now() + 38_000;
  const queueStatus = async () => {
    const { data, error } = await db.rpc("retention_media_queue_status");
    if (error || typeof data?.workDue !== "boolean" || !Number.isInteger(data.oldestDueMinutes))
      throw new Error("Media cleanup queue status unavailable.");
    return data as { workDue: boolean; oldestDueMinutes: number };
  };
  const totals = { completed: 0, failed: 0, oldestDueMinutes: 0 };
  if (!(await queueStatus()).workDue) return totals;
  await exportDeletionRecovery(db);
  try {
    while (performance.now() + 4_000 < deadline) {
      const batch = await processRetentionMedia(db, 4);
      totals.completed += batch.completed;
      totals.failed += batch.failed;
      if (batch.completed + batch.failed === 0) break;
    }
  } finally {
    await exportDeletionRecovery(db);
  }
  totals.oldestDueMinutes = (await queueStatus()).oldestDueMinutes;
  return totals;
}
export async function exportDeletionRecovery(db: SupabaseClient) {
  const lease = randomUUID();
  const result = await db.rpc("export_deletion_recovery", { p_lease: lease });
  if (result.error || !result.data || !Array.isArray(result.data.ledger) || !Array.isArray(result.data.media)) throw new Error("Recovery export unavailable");
  const bytes = Buffer.from(JSON.stringify(result.data));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const uploaded = await db.storage.from(RECOVERY_BUCKET).upload("current.json", bytes, { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (uploaded.error || uploaded.data?.path !== "current.json") throw new Error("Recovery export upload unconfirmed");
  const readback = await db.storage.from(RECOVERY_BUCKET).download("current.json");
  if (readback.error || !readback.data || createHash("sha256").update(Buffer.from(await readback.data.arrayBuffer())).digest("hex") !== sha256) throw new Error("Recovery export verification failed");
  const saved = await db.rpc("confirm_deletion_recovery_export", { p_lease: lease, p_sequence: result.data.throughSequence, p_sha256: sha256 });
  if (saved.error || saved.data !== true) throw new Error("Recovery export receipt missing");
  return { exported: true, throughSequence: result.data.throughSequence };
}

export async function retryClosedAccountDeletion(db: SupabaseClient) {
  const candidates = await db.rpc("closed_accounts_for_retention");
  if (candidates.error || !Array.isArray(candidates.data)) throw new Error("Account cleanup candidates unavailable");
  let completed = 0, failed = 0;
  for (const id of candidates.data) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid account cleanup reference");
    // Retry the existing, explicitly requested account closure through the supported Auth API.
    const result = await db.auth.admin.deleteUser(id);
    if (result.error) failed++; else completed++;
  }
  const receipt = await db.from("lifecycle_retention_runs").insert({ source: "closed_accounts", status: failed ? "failed" : "completed", removed: completed,
    error_code: failed ? "auth_cleanup_unconfirmed" : null, retry_after: failed ? new Date(Date.now() + 3600000).toISOString() : null });
  if (receipt.error) throw new Error("Account deletion receipt unavailable");
  return { completed, failed };
}
