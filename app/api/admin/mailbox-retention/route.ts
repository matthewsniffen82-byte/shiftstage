import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createZohoMailbox, zohoMailboxConfig } from "@/src/lib/dancr/zoho-mailbox.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const invalid = (message: string): never => { throw new PublicApiError("INVALID_REQUEST", message, 400); };
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "owner");
    const db = createAdminSupabaseClient();
    const [preview, cases, support] = await Promise.all([
      db.rpc("preview_mailbox_retention"),
      db.from("content_reports").select("id,case_kind,status,retention_closed_at").in("case_kind", ["safety", "privacy", "support"]).in("status", ["resolved", "removed"]).order("retention_closed_at").limit(100),
      db.from("support_threads").select("id,status,retention_closed_at").eq("status", "closed").order("retention_closed_at").limit(100),
    ]);
    if (preview.error || cases.error || support.error) throw new Error("Mailbox review unavailable");
    const config = zohoMailboxConfig();
    return NextResponse.json({ ok: true, configured: !!config, mailbox: config?.address || null, preview: preview.data,
      cases: [...(cases.data || []).map(c => ({ ...c, source: "content_reports" })), ...(support.data || []).map(c => ({ ...c, source: "support_threads", case_kind: "support" }))], session }, { headers });
  } catch (error) { return apiError(error, "Unable to load mailbox retention."); }
}
export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "owner");
    const body = await readBoundedJsonObject(request, { maxBytes: 16_384, invalidMessage: "Invalid mailbox operation.", tooLargeMessage: "Mailbox operation is too large." });
    const db = createAdminSupabaseClient();
    const config = zohoMailboxConfig();
    if (body.action === "pause" || body.action === "enable") {
      if (body.jobId != null && !uuid(body.jobId)) invalid("Invalid mailbox item.");
      if (body.action === "enable" && !config) invalid("Connect the dedicated mailbox first.");
      if (body.action === "enable") await createZohoMailbox(config);
      const changed = await db.rpc("set_mailbox_retention", { p_actor: user.id, p_enabled: body.action === "enable", p_job: body.jobId || null });
      if (changed.error || changed.data !== true) throw new Error("Mailbox setting was not saved");
      return NextResponse.json({ ok: true, session }, { headers });
    }
    if (!config) invalid("The dedicated Zoho mailbox connection has not been authorized.");
    if (!["discover", "schedule"].includes(String(body.action)) || !["content_reports", "support_threads"].includes(String(body.source)) || !uuid(body.caseId)) invalid("Choose a closed case.");
    const context = await db.rpc("mailbox_case_context", { p_source: body.source, p_id: body.caseId });
    if (context.error || !context.data) invalid("This case needs a closure, policy or preservation review before scheduling.");
    const mailbox = await createZohoMailbox(config);
    const phrase = typeof body.searchPhrase === "string" && body.searchPhrase.trim() ? body.searchPhrase.trim() : String(body.caseId);
    if (phrase.length < 8 || phrase.length > 150 || /["\r\n]/.test(phrase) || phrase.includes("::")) invalid("Use a short exact phrase from the email subject, without quotation marks or search operators.");
    const messages = await mailbox.searchCase(phrase);
    if (body.action === "discover") return NextResponse.json({ ok: true, context: context.data, messages, mailbox: mailbox.address, session }, { headers });
    if (body.confirmed !== true || !Array.isArray(body.messageIds) || body.messageIds.length < 1 || body.messageIds.length > 100 || body.messageIds.some(id => typeof id !== "string" || !/^[0-9]{1,24}$/.test(id))) invalid("Confirm the purpose of the selected case emails.");
    const chosen = messages.filter(m => (body.messageIds as string[]).includes(m.messageId));
    if (chosen.length !== new Set(body.messageIds as string[]).size) invalid("Some messages moved or are no longer found. Search again.");
    if (body.earlierAt != null && body.earlierAt !== "" && (typeof body.earlierAt !== "string" || !Number.isFinite(Date.parse(body.earlierAt)))) invalid("Enter a valid earlier deletion date.");
    if (body.reason != null && (typeof body.reason !== "string" || body.reason.length > 500)) invalid("Use a short minimization reason without personal content.");
    const result = await db.rpc("enroll_mailbox_retention", { p_actor: user.id, p_source: body.source, p_source_id: body.caseId, p_account: mailbox.accountId,
      p_messages: chosen.map(m => ({ messageId: m.messageId, folderId: m.folderId })), p_earlier: body.earlierAt || null, p_reason: body.reason || "", p_search: phrase });
    if (result.error) throw new PublicApiError("CONFLICT", "The case or retention decision changed. Refresh and review it again.", 409);
    return NextResponse.json({ ok: true, scheduled: result.data, session }, { headers });
  } catch (error) { return apiError(error, "Mailbox operation could not be confirmed."); }
}
