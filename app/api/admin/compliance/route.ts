import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { CASE_FIELDS, RECORD_FIELDS, RECORD_STATUSES, type RecordKind } from "@/src/lib/dancr/compliance-fields";
import { privacyIntake, safetyIntake, SAFETY_REASONS } from "@/src/lib/dancr/public-case-intake";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const invalid = (message: string): never => { throw new PublicApiError("INVALID_REQUEST", message, 400); };
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function fields(value: unknown, allowed: string[], max: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Enter record fields.");
  for (const [key, v] of Object.entries(value)) if (!allowed.includes(key) || typeof v !== "string" || v.length > max) invalid(`Invalid field: ${key.slice(0, 50)}.`);
  return value as Record<string, string>;
}
function check(result: { error: { code?: string; message?: string } | null }) {
  if (!result.error) return;
  // Only application-raised exceptions are suitable for this owner-only workflow.
  if (result.error.code === "P0001") throw new PublicApiError("CONFLICT", result.error.message || "Refresh and check the record.", 409);
  throw result.error;
}
export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const db = createAdminSupabaseClient();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") || "staffing";
    if (!Object.hasOwn(RECORD_FIELDS, kind)) invalid("Unknown register.");
    const page = Math.max(0, Math.min(10000, Number(params.get("page")) || 0));
    const casePage = Math.max(0, Math.min(10000, Number(params.get("casePage")) || 0));
    const status = params.get("status") === "closed" ? ["resolved", "removed"] : ["open"];
    const results = await Promise.all([
      db.from("content_reports").select("*", { count: "exact" }).in("case_kind", ["safety", "privacy"]).in("status", status).order("next_action_due_at").order("id").range(casePage * 25, casePage * 25 + 24),
      db.from("compliance_records").select("*", { count: "exact" }).eq("kind", kind).order("title").order("id").range(page * 25, page * 25 + 24),
      db.from("app_users").select("id,display_name,email").eq("role", "admin").eq("account_state", "active").eq("admin_workspace_role", "owner").order("display_name"),
      db.from("compliance_events").select("*").order("id", { ascending: false }).limit(50),
      db.from("admin_review_email_deliveries").select("id,status,outcome,attempts,created_at,finished_at").eq("mailbox", "safety@mydancr.com").order("created_at", { ascending: false }).limit(20),
    ]);
    results.forEach(check);
    return NextResponse.json({ ok: true, cases: results[0].data, caseCount: results[0].count, records: results[1].data, recordCount: results[1].count,
      reviewers: results[2].data, events: results[3].data, alerts: results[4].data, session: session || null }, { headers });
  } catch (error) { return apiError(error, "Unable to load private operations."); }
}
export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, { maxBytes: 32_768, invalidMessage: "Invalid operation.", tooLargeMessage: "Operation is too large." });
    const db = createAdminSupabaseClient();
    let result;
    if (body.action === "workflow") {
      if (!uuid(body.id) || !Number.isInteger(body.revision) || Number(body.revision) < 0) invalid("Invalid case or revision.");
      const workflow = fields(body.fields, [...Object.keys(CASE_FIELDS), "ownerId", "backupId", "verification"], 2000);
      for (const key of ["nextDue", "responseDue"]) if (workflow[key] && !Number.isFinite(Date.parse(workflow[key]))) invalid(`Enter a valid ${key} timestamp.`);
      for (const key of ["ownerId", "backupId"]) if (workflow[key] && !uuid(workflow[key])) invalid("Choose a reviewer.");
      result = await db.rpc("save_case_workflow", { p_actor: user.id, p_id: body.id, p_revision: body.revision, p_workflow: workflow });
    } else if (body.action === "close" || body.action === "restrict") {
      if (!uuid(body.id) || typeof body.notes !== "string" || body.notes.trim().length < 10 || body.notes.length > 2000) invalid("Record the decision or restriction reason (10–2000 characters).");
      result = await db.rpc("close_public_case", { p_admin_id: user.id, p_report_id: body.id, p_action: body.action === "restrict" ? "restricted" : "resolved", p_notes: body.notes });
    } else if (body.action === "record") {
      if (typeof body.kind !== "string" || !Object.hasOwn(RECORD_FIELDS, body.kind)) invalid("Unknown register.");
      if (typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 160) invalid("Enter a title (3–160 characters).");
      if (!(RECORD_STATUSES as readonly unknown[]).includes(body.status)) invalid("Unknown status.");
      if (body.id && (!uuid(body.id) || !Number.isInteger(body.revision))) invalid("Invalid record or revision.");
      const entry = fields(body.fields, Object.keys(RECORD_FIELDS[body.kind as RecordKind].fields), 6000);
      for (const key of ["triggerAt", "dueAt"]) if (entry[key] && !Number.isFinite(Date.parse(entry[key]))) invalid(`Enter a valid ${key} timestamp.`);
      for (const key of ["policyId", "holdId"]) if (entry[key] && !uuid(entry[key])) invalid(`Enter the ${key} record ID.`);
      result = await db.rpc("save_compliance_record", { p_actor: user.id, p_id: body.id || null, p_revision: body.revision || 0,
        p_kind: body.kind, p_title: body.title, p_status: body.status, p_fields: entry });
    } else if (body.action === "external_case") {
      if (typeof body.receivedAt !== "string" || !Number.isFinite(Date.parse(body.receivedAt)) || Date.parse(body.receivedAt) > Date.now()) invalid("Record the actual original receipt time, not a future date.");
      if (typeof body.source !== "string" || body.source.trim().length < 3 || body.source.length > 300) invalid("Record the receipt channel and evidence reference.");
      if (typeof body.details !== "string" || body.details.length < 10 || body.details.length > 2000) invalid("Enter a minimal case summary (10–2000 characters).");
      let values;
      if (body.kind === "privacy") {
        const intake = privacyIntake(body);
        values = { case_kind: "privacy", priority: "normal", reason: intake.right, intake };
      } else if (body.kind === "safety") {
        if (!(SAFETY_REASONS as readonly unknown[]).includes(body.reason)) invalid("Choose a safety reason.");
        values = { ...safetyIntake(body, false), reason: body.reason };
      } else return invalid("Choose safety or privacy.");
      result = await db.rpc("record_external_case", { p_actor: user.id, p_received: new Date(String(body.receivedAt)).toISOString(), p_values: { ...values, details: body.details, source: body.source } });
    } else return invalid("Unknown operation.");
    check(result);
    return NextResponse.json({ ok: true, record: result.data, session: session || null }, { headers });
  } catch (error) { return apiError(error, "Unable to save. Check field values and refresh before retrying."); }
}
