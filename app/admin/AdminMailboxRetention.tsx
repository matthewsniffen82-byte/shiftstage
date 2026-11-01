"use client";
import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";

type Case = { id: string; source: string; case_kind: string; retention_closed_at: string | null };
type Job = { id: string; source_id: string; category: string; message_id: string; due_at: string; state: string; paused: boolean; blocker: string | null; last_checked_at: string | null; error_code: string | null };
type Data = { configured: boolean; mailbox: string | null; cases: Case[]; preview: { enabled: boolean; jobs: Job[]; jobCount: number; receipts: { id: string; created_at: string; outcome: string }[] } };
type Message = { messageId: string; folderId: string; subject: string; receivedAt: string; hasAttachment: boolean };
const date = (value: string) => new Date(value).toLocaleString();

export default function AdminMailboxRetention() {
  const [data, setData] = useState<Data | null>(null);
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [searchPhrase, setSearchPhrase] = useState("");
  const [caseKey, setCaseKey] = useState("");
  const [messages, setMessages] = useState<Message[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [context, setContext] = useState<{ closedAt: string; maximumDueAt: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [earlier, setEarlier] = useState(""), [reason, setReason] = useState("");
  useEffect(() => {
    let current = true;
    requestAdminJson("/api/admin/mailbox-retention", { cache: "no-store" })
      .then(value => { if (current) setData(value as Data); })
      .catch(() => { if (current) setError("Unable to load mailbox retention."); });
    return () => { current = false; };
  }, [refresh]);
  const chosen = data?.cases.find(c => `${c.source}:${c.id}` === caseKey);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestAdminJson("/api/admin/mailbox-retention", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: chosen?.source, caseId: chosen?.id, searchPhrase, ...extra }) });
      if (action === "discover") { setMessages(result.messages as Message[]); setContext(result.context as typeof context); setSelected([]); setConfirmed(false); }
      else { setRefresh(n => n + 1); setNotice(action === "schedule" ? "Selected emails are scheduled. The worker checks the current case, policy and holds before removal." : "Mailbox setting saved."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Mailbox operation could not be confirmed."); }
    finally { setBusy(false); }
  }
  return <section className="admin-compliance-card">
    <h3>Automatic mailbox deletion</h3>
    <p>Link reviewed case emails once. Hourly deletion then uses the original case closure and adopted retention period. Unnecessary copies and extra identity material need an earlier disposal decision.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data ? <p>Loading mailbox controls…</p> : <>
      <p>Mailbox: {data.mailbox || "Dedicated Zoho connection required"}. Automatic deletion: {data.configured ? data.preview.enabled ? "Enabled" : "Paused" : "Not connected"}.</p>
      <button type="button" disabled={busy || !data.configured} onClick={() => void act(data.preview.enabled ? "pause" : "enable")}>{data.preview.enabled ? "Pause mailbox deletion" : "Enable mailbox deletion"}</button>{" "}
      <button type="button" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh mailbox status</button>
      <p>At the due date, reviewed messages and their attachments move to Trash, then the next successful worker pass removes those same messages from Trash. Both stages have receipts. Provider recovery expiry is separate. “Absent” means the message was not found in the case search; it does not certify provider erasure. Restored messages are checked again during the recorded recovery window.</p>
      <details><summary>Link a closed case’s emails</summary>
        <fieldset disabled={busy || !data.configured}>
          <label>Closed case<select value={caseKey} onChange={e => { setCaseKey(e.target.value); setMessages([]); setContext(null); setSelected([]); setConfirmed(false); setEarlier(""); setReason(""); setSearchPhrase(""); }}>
            <option value="">Choose a case</option>{data.cases.map(c => <option key={`${c.source}:${c.id}`} value={`${c.source}:${c.id}`} disabled={!c.retention_closed_at}>{c.case_kind} · {c.id}{!c.retention_closed_at ? " · closure date required" : ""}</option>)}
          </select></label>
          <p>Up to 100 closed safety/privacy cases and 100 closed support threads are listed. Record mail-only cases in the external-request form first. For emails without a case number, use a distinctive phrase from the subject and review each match.</p>
          <label>Exact email phrase (optional)<input maxLength={150} value={searchPhrase} onChange={e => { setSearchPhrase(e.target.value); setContext(null); setMessages([]); setSelected([]); setConfirmed(false); }} placeholder="Leave blank to find the case number" /></label>
          <button type="button" disabled={!chosen} onClick={() => void act("discover")}>Find case emails</button>
          {context && <>
            <p>Original closure: {date(context.closedAt)}. Maximum deletion date: {date(context.maximumDueAt)}.</p>
            <p>Review every relevant incoming, sent and archived copy, including attachments. Search includes Spam and Trash. A search match alone does not establish purpose or lawful retention. <a href="https://mail.zoho.com/zm/" target="_blank" rel="noreferrer">Review in Zoho Mail</a>.</p>
            {messages.length ? messages.map(m => <label key={m.messageId}><input type="checkbox" checked={selected.includes(m.messageId)} onChange={e => setSelected(ids => e.target.checked ? [...ids, m.messageId] : ids.filter(id => id !== m.messageId))} /> {m.subject || "No subject"}{m.hasAttachment ? " · attachment requires review" : ""} · {m.messageId}</label>) : <p>No matching emails found. Do not assume unrelated or unreferenced copies were deleted.</p>}
            <label>Earlier deletion date, if no longer needed<input type="datetime-local" value={earlier} onChange={e => setEarlier(e.target.value)} /></label>
            {earlier && <label>Reason for earlier disposal<textarea maxLength={500} minLength={10} value={reason} onChange={e => setReason(e.target.value)} placeholder="Minimal purpose-based reason; no personal details" /></label>}
            <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked these messages belong to this case and authorize automatic removal, including from Trash, at this deadline. Unnecessary identity material and duplicates have been addressed separately.</label>
            <button type="button" disabled={!confirmed || !selected.length || !!earlier && reason.trim().length < 10} onClick={() => void act("schedule", { messageIds: selected, confirmed, earlierAt: earlier ? new Date(earlier).toISOString() : null, reason })}>Schedule selected emails</button>
          </>}
        </fieldset>
      </details>
      <details><summary>Scheduled email copies ({data.preview.jobCount})</summary>
        <p>Showing the earliest {data.preview.jobs.length} items. Any active preservation hold pauses automatic mailbox deletion. Reopened or changed cases require a fresh review.</p>
        {data.preview.jobs.map(j => <div key={j.id}><p>{j.category} · {j.source_id}<br />Email {j.message_id} · Due {date(j.due_at)}<br />{j.state}{j.blocker ? ` · ${j.blocker.replaceAll("_", " ")}` : ""}{j.error_code ? ` · ${j.error_code.replaceAll("_", " ")}` : ""}{j.last_checked_at ? ` · checked ${date(j.last_checked_at)}` : ""}</p>
          <button type="button" disabled={busy || !data.configured && j.paused} onClick={() => void act(j.paused ? "enable" : "pause", { jobId: j.id })}>{j.paused ? "Resume item" : "Pause item"}</button></div>)}
      </details>
      <details><summary>Recent mailbox receipts</summary>{data.preview.receipts.map(r => <p key={r.id}>{date(r.created_at)} · {r.outcome.replaceAll("_", " ")}</p>)}</details>
    </>}
  </section>;
}
