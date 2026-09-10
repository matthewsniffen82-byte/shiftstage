import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTER_STATUSES = new Set(["submitted", "forwarded", "rejected", "withdrawn", "completed"]);
const CASE_STATUSES = new Set(["submitted", "needs_information", "rejected", "countered", "court_hold", "restored", "closed"]);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export async function recordDmcaCounterSubmission(client: SupabaseClient, userId: string, caseId: string, details: Record<string, string | boolean>) {
  const { data, error } = await client.rpc("submit_dmca_counter_notice_safely", { p_user_id: userId, p_case_id: caseId, p_details: details });
  if (error) {
    if (error.code === "P0002" || error.code === "42501") throw new PublicApiError("NOT_FOUND", "Copyright case not found.", 404);
    if (error.code === "23505") throw new PublicApiError("CONFLICT", "A counter-notice with different details was already submitted for this case. Review the existing case.", 409);
    if (error.code === "22023") throw new PublicApiError("INVALID_REQUEST", "This case is not eligible for this counter-notice. Check the case and your details.", 400);
    if (["40001", "40P01", "55P03", "57014", "PGRST202"].includes(error.code) || error.code?.startsWith("08")) {
      throw new PublicApiError("UNAVAILABLE", "The submission could not be confirmed. Reopen the case or retry with the same details.", 503);
    }
    throw error;
  }
  const counter = data?.counter, dmcaCase = data?.case;
  if (!counter || !dmcaCase || typeof data.duplicate !== "boolean"
    || typeof counter.id !== "string" || !UUID.test(counter.id) || counter.case_id !== caseId.toLowerCase()
    || dmcaCase.id !== caseId.toLowerCase() || !COUNTER_STATUSES.has(counter.status) || !CASE_STATUSES.has(dmcaCase.status)
    || !timestamp(counter.created_at) || !timestamp(dmcaCase.counter_received_at)
    || !timestamp(dmcaCase.restore_eligible_at) || !timestamp(dmcaCase.restore_deadline_at)
    || Date.parse(dmcaCase.restore_eligible_at) <= Date.parse(dmcaCase.counter_received_at)
    || Date.parse(dmcaCase.restore_deadline_at) <= Date.parse(dmcaCase.restore_eligible_at)
    || typeof dmcaCase.claimant_name !== "string" || !dmcaCase.claimant_name
    || typeof dmcaCase.claimant_email !== "string" || !dmcaCase.claimant_email
    || (!data.duplicate && (counter.status !== "submitted" || dmcaCase.status !== "countered"
      || Date.parse(counter.created_at) !== Date.parse(dmcaCase.counter_received_at)))) {
    throw new PublicApiError("UNAVAILABLE", "The submission could not be confirmed. Reopen the case or retry with the same details.", 503);
  }
  return {
    id: counter.id as string, caseId: dmcaCase.id as string, status: counter.status as string,
    caseStatus: dmcaCase.status as string, duplicate: data.duplicate as boolean,
    counterReceivedAt: dmcaCase.counter_received_at as string,
    restoreEligibleAt: dmcaCase.restore_eligible_at as string, restoreDeadlineAt: dmcaCase.restore_deadline_at as string,
    claimantName: dmcaCase.claimant_name as string, claimantEmail: dmcaCase.claimant_email as string,
  };
}
