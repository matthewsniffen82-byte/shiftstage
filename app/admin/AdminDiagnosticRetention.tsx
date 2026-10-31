"use client";
import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";

type Hold = { id: string; title: string; revision: number; status: string; scopeReviewed: boolean; mappedRecords: number };
type Preview = { asOf: string; cutoff: string; blocker: string | null; batchLimit: number; sources: { source: string; due: number; held: number }[]; holds: Hold[] };
type Receipt = { id: string; started_at: string; status: string; reason: string | null; removed_recovery: number; removed_counters: number; retry_after: string | null };
type Data = { preview: Preview; runs: Receipt[] };
const labels: Record<string, string> = { account_recovery_events: "Account-recovery diagnostics", request_rate_limit_buckets: "Expired request-limit counters" };
const blockers: Record<string, string> = { paused: "Paused by an owner", policy_review_required: "The adopted policy changed or is unavailable. Review the worker before restarting.", hold_scope_review_required: "Review and map the diagnostic scope of every active hold before cleanup resumes." };
const date = (s: string) => new Date(s).toLocaleString();

export default function AdminDiagnosticRetention() {
  const [data, setData] = useState<Data | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [holdId, setHoldId] = useState("");
  const [source, setSource] = useState("account_recovery_events");
  const [recordId, setRecordId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [keyType, setKeyType] = useState("ip");
  const [note, setNote] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestAdminJson("/api/admin/diagnostic-retention", { cache: "no-store", signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value as Data); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load cleanup."); });
    return () => controller.abort();
  }, [refresh]);
  const hold = data?.preview.holds.find(h => h.id === holdId);
  async function save(action: string, values: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      await requestAdminJson("/api/admin/diagnostic-retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) });
      setRefresh(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to confirm the change."); }
    finally { setBusy(false); }
  }
  return <section>
    <h3>Diagnostic cleanup</h3>
    <p>Runs hourly. Account-recovery diagnostics expire after 90 days. Request-limit counters are removed when their active window expires because their purpose has ended. Each run handles up to 500 records per source; remaining records and failures are retried hourly.</p>
    <p>This phase covers these two sources only. Email delivery records, cases, business activity, media, vendor copies and backups require separate handling.</p>
    <button type="button" disabled={busy} onClick={() => setRefresh(v => v + 1)}>Refresh cleanup preview</button>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading cleanup preview…</p>}
    {data && <>
      <p role="status">{data.preview.blocker ? blockers[data.preview.blocker] || "Cleanup requires review." : "Scheduled cleanup enabled"} · Preview {date(data.preview.asOf)}</p>
      <p>Recovery cutoff: {date(data.preview.cutoff)}. Previewing does not delete records.</p>
      <ul>{data.preview.sources.map(s => <li key={s.source}>{labels[s.source]}: {s.due} due, {s.held} protected by holds, {s.due - s.held} eligible once any pause is resolved.</li>)}</ul>
      <button type="button" disabled={busy} onClick={() => void save("enabled", { enabled: data.preview.blocker === "paused" })}>{data.preview.blocker === "paused" ? "Resume scheduled cleanup" : "Pause scheduled cleanup"}</button>
      <details><summary>Preservation exceptions</summary>
        <p>Create and verify the preservation record in the Holds register first. Map every covered diagnostic record below, then confirm the scope is complete. A new or changed hold pauses cleanup until its scope is reviewed. Holds for other data can be reviewed with zero diagnostic mappings and an explanation.</p>
        <p>These exceptions prevent deletion; they do not create an immutable evidence copy or replace the restricted preservation procedure. Release holds in the Holds register. Overdue records then qualify using their original dates.</p>
        <ul>{data.preview.holds.map(h => <li key={h.id}>{h.title}: {h.mappedRecords} mapped · {h.scopeReviewed ? "scope reviewed" : "review required"}</li>)}</ul>
        <fieldset disabled={busy}>
          <label>Verified hold<select value={holdId} onChange={e => setHoldId(e.target.value)}><option value="">Select a hold</option>{data.preview.holds.filter(h => h.status === "verified").map(h => <option key={h.id} value={h.id}>{h.title}</option>)}</select></label>
          <label>Diagnostic source<select value={source} onChange={e => { setSource(e.target.value); setRecordId(""); }}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {source === "request_rate_limit_buckets" && <><label>Counter namespace<input value={namespace} onChange={e => setNamespace(e.target.value)} maxLength={40} /></label><label>Counter type<select value={keyType} onChange={e => setKeyType(e.target.value)}><option value="ip">Network hash</option><option value="subject">Subject hash</option></select></label></>}
          <label>{source === "account_recovery_events" ? "Recovery event ID" : "Counter hash reference (UUID)"}<input value={recordId} onChange={e => setRecordId(e.target.value)} maxLength={36} /></label>
          <button type="button" disabled={!hold || !recordId} onClick={() => void save("protect", { holdId, revision: hold?.revision, source, recordKey: source === "account_recovery_events" ? [recordId] : [namespace, keyType, recordId] })}>Add record to this hold</button>
          <label>Scope review evidence<textarea maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button type="button" disabled={!hold || note.trim().length < 10} onClick={() => void save("review_hold", { holdId, revision: hold?.revision, note })}>Confirm all diagnostic records are mapped</button>
        </fieldset>
      </details>
      <details><summary>Latest cleanup receipts</summary><p>Receipts record database deletion counts and failures without copying deleted identifiers or payloads. They are retained for 90 days. They do not confirm provider or backup erasure.</p>
        {data.runs.length ? data.runs.map(r => <p key={r.id}>{date(r.started_at)} · {r.status} · {r.removed_recovery} recovery records, {r.removed_counters} counters removed{r.reason ? ` · ${blockers[r.reason] || r.reason}` : ""}{r.retry_after ? ` · Next retry ${date(r.retry_after)}` : ""}</p>) : <p>No runs recorded yet.</p>}
      </details>
    </>}
  </section>;
}
