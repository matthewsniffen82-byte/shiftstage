import { NextResponse } from "next/server";
import { processImageModerationRetryRecord } from "@/src/lib/dancr/image-moderation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JOBS_PER_RUN = 5;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabaseClient() as any;
  const now = new Date().toISOString();

  try {
    const { data: records, error } = await admin
      .from("image_moderation_records")
      .select("*")
      .in("status", ["moderation_retry", "error"])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order("next_attempt_at", { ascending: true, nullsFirst: true })
      .limit(MAX_JOBS_PER_RUN);

    if (error) throw error;

    const results = [];
    for (const record of records || []) {
      const claimed = await claimRetryRecord(admin, record.id);
      if (!claimed) continue;
      try {
        const result = await processImageModerationRetryRecord(admin, claimed);
        results.push({ recordId: claimed.id, decision: result.decision, ok: true });
      } catch (error) {
        console.error("IMAGE_MODERATION_RETRY_WORKER_FAILED", {
          imageId: claimed.image_id,
          moderationRecordId: claimed.id,
          storagePath: claimed.temporary_storage_path,
          attemptNumber: Number(claimed.attempt_count || 0) + 1,
          ...safeWorkerError(error),
        });
        results.push({ recordId: claimed.id, ok: false });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("IMAGE_MODERATION_RETRY_CRON_FAILED", safeWorkerError(error));
    return NextResponse.json({ ok: false, error: "Image moderation retry worker failed." }, { status: 500 });
  }
}

async function claimRetryRecord(admin: any, recordId: string) {
  const lockTime = new Date().toISOString();
  const { data, error } = await admin
    .from("image_moderation_records")
    .update({
      status: "moderating",
      locked_at: lockTime,
      updated_at: lockTime,
    })
    .eq("id", recordId)
    .in("status", ["moderation_retry", "error"])
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const expected = `Bearer ${secret}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

function safeWorkerError(error: unknown) {
  const anyError = error as any;
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error || "").slice(0, 500),
    errorStatus: Number(anyError?.status || anyError?.response?.status || 0) || undefined,
    errorCode: anyError?.code || anyError?.error?.code || undefined,
    errorType: anyError?.type || anyError?.error?.type || undefined,
    responseData: anyError?.response?.data ? JSON.stringify(anyError.response.data).slice(0, 500) : undefined,
    stack: error instanceof Error ? error.stack?.slice(0, 1000) : undefined,
  };
}
