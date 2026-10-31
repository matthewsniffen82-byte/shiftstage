"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useVisibleAutoRefresh } from "../components/useVisibleAutoRefresh";
import { mergeLiveRows } from "@/src/lib/merge-live-rows";
import { CASE_FIELDS, RECORD_FIELDS, RECORD_STATUSES, type RecordKind } from "@/src/lib/dancr/compliance-fields";
import { PRIVACY_RIGHTS, SAFETY_REASONS } from "@/src/lib/dancr/public-case-intake";
import { requestAdminJson } from "./admin-session";
import styles from "./AdminCompliance.module.css";
import AdminDiagnosticRetention from "./AdminDiagnosticRetention";

type Fields = Record<string, string>;
type Case = { id: string; case_kind: string; reason: string; status: string; priority: string; target_type: string; target_id: string | null; details: string; received_at: string; next_action_due_at: string; intake: Record<string, unknown>; workflow: Fields; workflow_revision: number; action_evidence: unknown };
type Entry = { id?: string; kind: RecordKind; title: string; status: string; fields: Fields; revision: number };
type Reviewer = { id: string; display_name: string; email: string };
type Data = { canManageRecords: boolean; cases: Case[]; caseCount: number; records: Entry[]; recordCount: number; reviewers: Reviewer[]; events: { id: number; action: string; created_at: string; case_id: string; record_id: string; actor_id: string }[]; alerts: { id: string; status: string; outcome: string; created_at: string }[] };
type Save = (body: Record<string, unknown>) => Promise<void>;
const showDate = (value: string) => value ? new Date(value).toLocaleString() : "Not set";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The operation could not be confirmed.";

export default function AdminCompliance({ visible }: { visible: boolean }) {
  const [kind, setKind] = useState<RecordKind>("staffing");
  const [page, setPage] = useState(0);
  const [casePage, setCasePage] = useState(0);
  const [caseStatus, setCaseStatus] = useState("open");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const readVersion = useRef(0);
  const caseDraft = useRef(false);
  useEffect(() => { caseDraft.current = false; }, [selected, refresh]);
  useEffect(() => {
    if (!visible) return;
    readVersion.current += 1;
    const controller = new AbortController();
    setError(""); setData(null);
    requestAdminJson(`/api/admin/compliance?kind=${kind}&page=${page}&casePage=${casePage}&status=${caseStatus}`, { cache: "no-store", signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value as Data); })
      .catch(e => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [visible, kind, page, casePage, caseStatus, refresh]);
  useVisibleAutoRefresh({
    active: visible && !busy,
    scopeKey: `${kind}:${page}:${casePage}:${caseStatus}:${refresh}:${selected || ""}`,
    refresh: async (signal, isCurrent) => {
      if (!data) return;
      const version = readVersion.current;
      const value = await requestAdminJson(`/api/admin/compliance?kind=${kind}&page=${page}&casePage=${casePage}&status=${caseStatus}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
      if (!isCurrent() || version !== readVersion.current) return;
      if (!Array.isArray(value.cases)) throw new Error("Cases are unavailable.");
      // Keep unsaved editor values and their original revision while updating the queue.
      setData(current => current ? { ...value, cases: mergeLiveRows(current.cases, value.cases as Case[], new Set(caseDraft.current && selected ? [selected] : [])) } as Data : current);
    },
  });
  const save: Save = useCallback(async body => {
    readVersion.current += 1;
    setError(""); setMessage(""); setBusy(true);
    try {
      await requestAdminJson("/api/admin/compliance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMessage("Saved. The server confirmed this record."); setEntry(null); setRefresh(v => v + 1);
    } catch (e) { setError(errorText(e)); throw e; }
    finally { setBusy(false); }
  }, []);
  const chosen = data?.cases.find(r => r.id === selected);
  return <div className={styles.root}>
    <p>Private safety and privacy operations. Alert inbox: <strong>safety@mydancr.com</strong>. Confirm primary and backup coverage below. Manage copyright notices in Copyright / DMCA.</p>
    <p>Use minimal references. Keep identity documents, selfies, reported media and secrets out of these fields. Record evidence from the restricted source.</p>
    <details><summary>Reviewer start-up checklist</summary><ol>
      <li>Confirm access to the shared inbox and the coverage contacts below. Read the internal Content Safety and Rights Procedure.</li>
      <li>Check urgent, unassigned and overdue cases first. Enter requests received elsewhere with their original receipt time.</li>
      <li>Assign a case owner and an available backup. Escalate urgent risks immediately; missing backup coverage must be raised with the owner.</li>
      <li>Restrict supported harmful content promptly when justified. Record the search for other copies and affected destinations.</li>
      <li>For privacy requests, determine authority, proportionate verification and applicable deadlines before disclosure or deletion.</li>
      <li>Record the actual action, notices, evidence reference, retention trigger and follow-up before closure. Use a linked follow-up for an appeal.</li>
      <li>Complete a harmless tabletop exercise with the owner and record training completion in the coverage register. Reading this checklist does not mark training complete.</li>
    </ol></details>
    <button type="button" disabled={busy} onClick={() => { setEntry(null); setRefresh(v => v + 1); }}>Refresh records</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data && !error && <p role="status">Loading private operations…</p>}
    {data && <>
      <h3>Safety & privacy cases</h3>
      <p>Prioritize urgent cases and the earliest due time. Restrict supported content immediately; finish the case record before closing it. Review overdue cases daily and arrange out-of-hours coverage.</p>
      <label>Queue <select disabled={busy} value={caseStatus} onChange={e => { setCaseStatus(e.target.value); setCasePage(0); setSelected(null); }}><option value="open">Open</option><option value="closed">Closed</option></select></label>
      <p>{data.caseCount} cases · page {casePage + 1}</p>
      <div className={styles.list}>{data.cases.map(r => <button disabled={busy} type="button" key={r.id} aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>
        <strong>{r.priority === "urgent" ? "URGENT · " : ""}{r.reason}</strong><br />{r.id}<br />Received {showDate(r.received_at)} · Due {showDate(r.next_action_due_at)}{r.status === "open" && Date.parse(r.next_action_due_at) < Date.now() ? " · OVERDUE" : ""}<br />{r.workflow.ownerId ? "Owner assigned" : "Unassigned"}
      </button>)}</div>
      {!data.cases.length && <p>No cases in this queue.</p>}
      <Pager page={casePage} count={data.caseCount} disabled={busy} onPage={v => { setCasePage(v); setSelected(null); }} />
      {chosen && <div onChangeCapture={() => { caseDraft.current = true; readVersion.current += 1; }}><CaseEditor key={`${chosen.id}:${chosen.workflow_revision}:${refresh}`} record={chosen} reviewers={data.reviewers} busy={busy} save={save} /></div>}
      <details><summary>Record an email or other external request</summary><p>Use the actual first receipt time. Re-entering a request must never restart its clock. For intimate-image requests, transcribe the requester’s statements accurately; do not certify on their behalf.</p><ExternalCase busy={busy} save={save} /></details>

      {data.canManageRecords ? <><AdminDiagnosticRetention /><h3>Operational registers</h3>
      <p>Drafts show outstanding evidence. A verified record is a reviewer’s attestation backed by the referenced evidence. Saving a record does not run a deletion, sign a contract, change a vendor setting or enforce an embed domain.</p>
      <label>Register <select disabled={busy} value={kind} onChange={e => { setKind(e.target.value as RecordKind); setPage(0); setEntry(null); }}>{Object.entries(RECORD_FIELDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => setEntry({ kind, title: "", status: "draft", fields: {}, revision: 0 })}>Add record</button>
      <p>{data.recordCount} records · page {page + 1}</p>
      <div className={styles.list}>{data.records.map(r => <button disabled={busy} type="button" key={r.id} onClick={() => setEntry(r)}><strong>{r.title}</strong><br />{r.status.replaceAll("_", " ")} · revision {r.revision}<br /><small>{r.id}</small></button>)}</div>
      <Pager page={page} count={data.recordCount} disabled={busy} onPage={v => { setPage(v); setEntry(null); }} />
      {entry && <RecordEditor key={`${entry.id || "new"}:${kind}:${entry.revision}`} record={entry} busy={busy} save={save} />}
      </> : <section><h3>Reviewers & coverage</h3>{data.records.map(r => <dl key={r.id}>{Object.entries(r.fields).map(([key, value]) => <div key={key}><dt>{RECORD_FIELDS.staffing.fields[key as keyof typeof RECORD_FIELDS.staffing.fields] || key}</dt><dd>{value}</dd></div>)}</dl>)}</section>}
      <details><summary>Latest shared-inbox alert receipts</summary><p>Provider acceptance confirms submission to the email provider, not inbox delivery or human review. Failed or pending alerts need attention. Due-soon and overdue cases are checked every minute; overdue reminders repeat hourly.</p>
        {data.alerts.length ? data.alerts.map(a => <p key={a.id}>{showDate(a.created_at)} · {a.status} · {a.outcome || "Waiting"}</p>) : <p>No shared-inbox alerts recorded yet.</p>}
      </details>
      <details><summary>Latest 50 audit events</summary>{data.events.map(e => <p key={e.id}>{showDate(e.created_at)} · {e.action}<br />Reference: {e.case_id || e.record_id} · Actor: {e.actor_id || "System"}</p>)}</details>
    </>}
  </div>;
}

function Pager({ page, count, disabled, onPage }: { page: number; count: number; disabled: boolean; onPage: (page: number) => void }) {
  return <div className={styles.actions}><button type="button" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>Previous</button><button type="button" disabled={disabled || (page + 1) * 25 >= count} onClick={() => onPage(page + 1)}>Next</button></div>;
}
function TextFields({ definitions, value, onChange, max = 2000 }: { definitions: Record<string, string>; value: Fields; onChange: (fields: Fields) => void; max?: number }) {
  return <div className={styles.fields}>{Object.entries(definitions).map(([key, label]) => <label key={key}>{label}<textarea rows={2} maxLength={max} value={value[key] || ""} onChange={e => onChange({ ...value, [key]: e.target.value })} /></label>)}</div>;
}
function CaseEditor({ record, reviewers, busy, save }: { record: Case; reviewers: Reviewer[]; busy: boolean; save: Save }) {
  const [value, setValue] = useState<Fields>({ jurisdiction: String(record.intake.jurisdiction || ""), authority: String(record.intake.authority || ""), verification: record.intake.verificationStatus === "not_required" ? "not_required" : "pending", nextDue: record.next_action_due_at, ...record.workflow });
  const [notes, setNotes] = useState("");
  const closed = record.status !== "open";
  const act = (action: string) => {
    if (action === "restrict" && !window.confirm("Restrict this reported target now? A profile or club target disables the whole profile or club. The case will stay open for review and follow-up.")) return;
    void save({ action, id: record.id, notes }).catch(() => {});
  };
  return <section className={styles.editor}>
    <h4>Case {record.id}</h4><p>{record.details}</p>
    {record.case_kind === "safety" && record.reason === "Nonconsensual intimate image" && <p><strong>Removal deadline: {showDate(new Date(Date.parse(record.received_at) + 48 * 3_600_000).toISOString())}</strong>. The internal first-action target is earlier; requests for clarification do not restart this clock.</p>}
    <details><summary>Original intake and restriction receipt</summary><pre>{JSON.stringify({ intake: record.intake, restriction: record.action_evidence }, null, 2)}</pre></details>
    <form onSubmit={e => { e.preventDefault(); void save({ action: "workflow", id: record.id, revision: record.workflow_revision, fields: value }).catch(() => {}); }}>
      <fieldset disabled={busy || closed}><legend>Case workflow</legend>
        {[["ownerId", "Primary case owner"], ["backupId", "Backup reviewer"]].map(([key, label]) => <label key={key}>{label}<select value={value[key] || ""} onChange={e => setValue({ ...value, [key]: e.target.value })}><option value="">Unassigned</option>{reviewers.map(r => <option key={r.id} value={r.id}>{r.display_name || r.email}</option>)}</select></label>)}
        <label>Verification outcome<select value={value.verification || "pending"} onChange={e => setValue({ ...value, verification: e.target.value })}>{["pending", "verified", "not_required", "failed"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label>
        <TextFields definitions={CASE_FIELDS} value={value} onChange={setValue} />
        <button type="submit">Save workflow</button>
      </fieldset>
    </form>
    {!closed && <fieldset disabled={busy}><legend>Content action / closure</legend><p>Save workflow changes first. Restriction does not require a completed closure record. For a location-only report, locate the content in the moderation tools and record the evidence here.</p>
      <label>Action reason / closure summary<textarea minLength={10} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <div className={styles.actions}>{record.case_kind === "safety" && record.target_id && record.target_type !== "contact_message" && <button type="button" disabled={notes.trim().length < 10} onClick={() => act("restrict")}>Restrict content; keep case open</button>}
        <button type="button" disabled={notes.trim().length < 10} onClick={() => act("close")}>Close reviewed case</button></div>
    </fieldset>}
  </section>;
}
function RecordEditor({ record, busy, save }: { record: Entry; busy: boolean; save: Save }) {
  const [value, setValue] = useState(record.fields);
  const [title, setTitle] = useState(record.title);
  const [status, setStatus] = useState(record.status);
  return <form className={styles.editor} onSubmit={e => { e.preventDefault(); void save({ action: "record", id: record.id, revision: record.revision, kind: record.kind, title, status, fields: value }).catch(() => {}); }}>
    <fieldset disabled={busy}><legend>{RECORD_FIELDS[record.kind].label}</legend>
      {record.id && <p>Record ID: {record.id}</p>}
      <label>Title<input required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{RECORD_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
      {record.kind === "retention" && <p>Use “verified” only after adoption and evidence review. The proposed periods are not active deletion rules.</p>}
      {record.kind === "deletion" && <p>This is a fulfillment ledger. Execute deletion through the responsible systems, then record each confirmation. A soft-delete flag does not prove destruction. Preserve the original trigger when releasing a hold.</p>}
      {record.kind === "hold" && <p>Use “completed” only when the hold has been released. Check every linked deletion item against its original due date.</p>}
      <TextFields definitions={RECORD_FIELDS[record.kind].fields} value={value} onChange={setValue} max={6000} />
      <button type="submit">Save record</button>
    </fieldset>
  </form>;
}
function ExternalCase({ busy, save }: { busy: boolean; save: Save }) {
  const [kind, setKind] = useState("safety");
  const [value, setValue] = useState<Fields>({});
  const [reason, setReason] = useState<string>(SAFETY_REASONS[0]);
  const [faith, setFaith] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); void save({ action: "external_case", kind, ...value, reason, right: reason, goodFaith: faith }).then(() => { setValue({}); setFaith(false); }).catch(() => {}); };
  return <form onSubmit={submit}><fieldset disabled={busy}><legend>Original request</legend>
    <label>Kind<select value={kind} onChange={e => { setKind(e.target.value); setReason(e.target.value === "safety" ? SAFETY_REASONS[0] : PRIVACY_RIGHTS[0]); }}><option value="safety">Safety</option><option value="privacy">Privacy</option></select></label>
    <label>Reason<select value={reason} onChange={e => setReason(e.target.value)}>{(kind === "safety" ? SAFETY_REASONS : PRIVACY_RIGHTS).map(r => <option key={r}>{r}</option>)}</select></label>
    <TextFields definitions={{ receivedAt: "Actual original receipt (ISO timestamp, including time zone)", source: "Receipt channel and evidence reference", contactEmail: "Requester contact email", details: "Minimal summary", authority: "Requester’s authority statement", ...(kind === "safety" ? { contentLocation: "Exact content location", requestedAction: "Requester’s requested action", signature: "Requester’s signature as received" } : { jurisdiction: "Requester’s jurisdiction", previousReference: "Related case / appeal reference" }) }} value={value} onChange={setValue} />
    {kind === "safety" && <label><input type="checkbox" checked={faith} onChange={e => setFaith(e.target.checked)} />The received request includes the requester’s good-faith statement.</label>}
    <button type="submit">Record original request</button>
  </fieldset></form>;
}
