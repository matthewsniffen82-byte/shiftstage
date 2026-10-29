import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getAccountByUserId, requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { requireDancerAgreementAcceptance } from "@/src/lib/dancr/dancer-agreement";
import { withSignedThumbnail } from "@/src/lib/dancr/image-review";
import { MYDANCR_TV_BUCKET, normalizedVideoPosterStoragePath } from "@/src/lib/dancr/tv";
import { MYDANCR_TV_POSTER_BUCKET } from "@/src/lib/dancr/media-watermark";
import { prepareMediaBatch } from "@/src/lib/dancr/media-batch-preparation";
import { runWithServerJob } from "@/src/lib/server-job";
import { mainPhotoPreviews } from "@/src/lib/dancr/media-review-main-photo";
import { venueMediaAvatar } from "@/src/lib/dancr/venue-media-avatar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown) => NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
async function rpc(db: any, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error?.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot review this batch.", 403);
  if (error && ["40001", "22023", "P0002"].includes(error.code)) throw new PublicApiError("CONFLICT",
    error.code === "22023" ? error.message : "This batch changed. Refresh before continuing.", 409);
  if (error) throw error;
  return data;
}
async function context(request: Request) {
  const ctx = await createRequestSupabaseContext(request);
  const db = createAdminSupabaseClient() as any;
  const account = await getAccountByUserId(ctx.client, ctx.user.id);
  if (account?.accountState !== "active" || !["admin", "venue", "dancer"].includes(account.role)) {
    throw new PublicApiError("FORBIDDEN", "An active account is required.", 403);
  }
  let venueId: string | null = null;
  if (account.role === "admin") await requireAdmin(ctx.client, ctx.user.id, "reviewer");
  if (account.role === "venue") {
    await requireActiveVenueAccount(ctx.client, ctx.user.id);
    venueId = (await requireVenueAccess(db, ctx.user.id, "manage_roster")).venueId;
  }
  return { ...ctx, db, role: account.role, venueId };
}
async function detail(ctx: Awaited<ReturnType<typeof context>>, batchId: unknown) {
  if (typeof batchId !== "string" || !uuid.test(batchId)) throw new PublicApiError("INVALID_REQUEST", "Choose a batch.", 400);
  const batch = await rpc(ctx.db, "get_media_batch", { p_actor: ctx.user.id, p_role: ctx.role, p_batch: batchId });
  if (ctx.role === "venue" && batch.venue_id !== ctx.venueId) throw new PublicApiError("FORBIDDEN", "Choose a batch for your current club.", 403);
  return batch;
}
export async function GET(request: Request) {
  try {
    const ctx = await context(request), params = new URL(request.url).searchParams;
    if (!params.has("batchId")) {
      const dancerId = params.get("dancerId"), venueId = ctx.venueId || (ctx.role === "admin" ? params.get("venueId") : null);
      if ((dancerId && !uuid.test(dancerId)) || (venueId && !uuid.test(venueId))) throw new PublicApiError("INVALID_REQUEST", "Choose a valid review queue.", 400);
      const result = await rpc(ctx.db, "get_media_batches", { p_actor: ctx.user.id, p_role: ctx.role, p_venue: venueId || null, p_dancer: dancerId || null });
      if (ctx.role !== "dancer") {
        const previews = await mainPhotoPreviews(ctx.db, result.batches.map((b: any) => b.dancer_id));
        result.batches = result.batches.map((b: any) => ({ ...b, previewUrl: previews.get(b.dancer_id) || "" }));
      }
      return json({ ok: true, ...result, session: ctx.session });
    }
    const batch = await detail(ctx, params.get("batchId"));
    const offset = Math.max(0, Math.min(150, Number.parseInt(params.get("offset") || "0", 10) || 0));
    const relevant = (item: any) => !item.withdrawn && (ctx.role === "venue" || (!item.resolved && item.club?.decision === "approved"));
    const unreviewed = batch.items.filter((item: any) => relevant(item) && !(ctx.role === "venue" ? item.club : item.admin)?.decision).length;
    const items = await Promise.all(batch.items.slice(offset, offset + 12).map(async (item: any) => {
      let previewUrl = "", posterUrl = "";
      if (item.record && !item.withdrawn) {
        if (item.kind === "photo") previewUrl = (await withSignedThumbnail(ctx.db, item.record)).thumbnailUrl;
        else {
          previewUrl = (await ctx.db.storage.from(MYDANCR_TV_BUCKET).createSignedUrl(item.record.storage_path, 300)).data?.signedUrl || "";
          const path = normalizedVideoPosterStoragePath(item.record);
          if (path) posterUrl = (await ctx.db.storage.from(MYDANCR_TV_POSTER_BUCKET).createSignedUrl(path, 300)).data?.signedUrl || "";
        }
      }
      const { record: _record, ...safe } = item;
      return { ...safe, previewUrl, posterUrl, editable: relevant(item), label: item.isMain ? "Main photo" : item.kind === "video" ? "Video" : "Photo" };
    }));
    const avatar = ctx.role === "venue" ? await venueMediaAvatar(ctx.db, batch.dancer_id) : null;
    return json({ ok: true, batch: { id: batch.id, state: batch.state, revision: batch.revision, items, avatarUrl: avatar?.url || "",
      total: batch.items.length, unreviewed, result: batch.result }, session: ctx.session });
  } catch (error) { return apiError(error, "Unable to load media batches."); }
}
export async function POST(request: Request) {
  try {
    return await runWithServerJob(async () => {
      const ctx = await context(request);
      const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid batch submission.", tooLargeMessage: "Review notes are too long." });
      if (ctx.role === "dancer" && body.action === "submit") {
        await requireDancerAgreementAcceptance(ctx.client);
        const result = await rpc(ctx.db, "submit_dancer_media_batch", { p_actor: ctx.user.id });
        return json({ ok: true, ...result, session: ctx.session });
      }
      if (!["venue", "admin"].includes(ctx.role)) throw new PublicApiError("FORBIDDEN", "Reviewer account required.", 403);
      const batch = await detail(ctx, body.batchId);
      if (typeof body.revision !== "string" || !uuid.test(body.revision)) throw new PublicApiError("INVALID_REQUEST", "Refresh this batch.", 400);
      const args = { p_actor: ctx.user.id, p_batch: batch.id, p_revision: body.revision };
      let result;
      if (body.action === "save") {
        if (typeof body.key !== "string" || !["approved", "rejected"].includes(String(body.decision)) || typeof body.notes !== "string" || body.notes.length > 4000) {
          throw new PublicApiError("INVALID_REQUEST", "Choose an item and decision.", 400);
        }
        result = await rpc(ctx.db, "save_media_batch_decision", { ...args, p_role: ctx.role, p_key: body.key, p_decision: body.decision, p_notes: body.notes });
      } else if (body.action === "submit") {
        if (ctx.role === "admin" && batch.state === "admin" && batch.revision === body.revision) await prepareMediaBatch(ctx.db, batch);
        result = await rpc(ctx.db, ctx.role === "admin" ? "submit_admin_media_batch" : "submit_club_media_batch", args);
      } else throw new PublicApiError("INVALID_REQUEST", "Choose a batch action.", 400);
      return json({ ok: true, ...result, session: ctx.session });
    }, 270000);
  } catch (error) { return apiError(error, "Unable to submit this batch. Your saved choices are retained; refresh and try again."); }
}
