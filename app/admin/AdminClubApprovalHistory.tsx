"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { readAdminSession, requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";
import styles from "./club-approval-history.module.css";

type Approval = { id: string; venueName: string; city: string; state: string; status: string; contactName: string;
  loginEmail: string | null; submittedAt: string; reviewedAt: string; reviewNotes: string | null; reviewedBy: string; canResend: boolean;
  resends: Array<{ id: string; at: string; by: string; status: string }> };
function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "Not recorded" : parsed.toLocaleString(); }

export default function AdminClubApprovalHistory({ onActionConfirmed }: { onActionConfirmed: (message: string) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ search: "", status: "all", page: 0 });
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const sendRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener(ADMIN_DATA_CHANGED, changed);
    return () => { mounted.current = false; sendRequest.current?.abort(); window.removeEventListener(ADMIN_DATA_CHANGED, changed); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const query = new URLSearchParams({ status: filter.status, search: filter.search, page: String(filter.page) });
    void requestAdminJson(`/api/admin/club-approvals?${query}`, { signal: controller.signal, cache: "no-store", fallbackMessage: "Unable to load club approval history." })
      .then(data => { if (!controller.signal.aborted) { setRows(data.requests || []); setTotal(data.total || 0); setHasMore(data.hasMore === true); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load history."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, revision]);

  function find(event: FormEvent) { event.preventDefault(); setFilter(current => ({ ...current, search: search.trim(), page: 0 })); }
  async function resend(row: Approval) {
    if (!row.canResend || sendRequest.current) return;
    const controller = new AbortController(); sendRequest.current = controller;
    const accountId = readAdminSession()?.account?.id;
    const current = () => mounted.current && !controller.signal.aborted && readAdminSession()?.account?.id === accountId;
    setSending(row.id); setNotice(`Sending dashboard link for ${row.venueName}…`);
    try {
      const data = await requestAdminJson("/api/admin/club-approvals", { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resend", requestId: row.id }),
        fallbackMessage: "Unable to send the dashboard link. Refresh history before retrying.",
      });
      if (!current()) return;
      setNotice(data.message);
      if (data.delivered) onActionConfirmed(data.message);
    } catch (reason) {
      if (current()) setNotice(reason instanceof Error ? reason.message : "Unable to send the link.");
    } finally {
      if (sendRequest.current === controller) sendRequest.current = null;
      if (current()) { setSending(""); setRevision(value => value + 1); }
    }
  }

  return <section className={styles.history} aria-label="Club approval history">
    <p>Find previous decisions and resend dashboard access to an approved club.</p>
    <form className={styles.tools} onSubmit={find}>
      <label>Club name<input value={search} maxLength={160} placeholder="Search clubs" onChange={event => setSearch(event.target.value)} disabled={Boolean(sending)} /></label>
      <label>Decision<select value={filter.status} onChange={event => setFilter(current => ({ ...current, status: event.target.value, page: 0 }))} disabled={Boolean(sending)}>
        <option value="all">All decisions</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
      </select></label>
      <button type="submit" disabled={Boolean(sending)}>Search</button>
      <button type="button" className="secondary" disabled={loading || Boolean(sending)} onClick={() => setRevision(value => value + 1)}>Refresh history</button>
    </form>
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading approval history…</p> : <>
      <small>{total} {total === 1 ? "decision" : "decisions"} · Page {filter.page + 1}</small>
      {rows.map(row => <details key={row.id} className={styles.record}>
        <summary><span><strong>{row.venueName}</strong><small>{[row.city, row.state].filter(Boolean).join(", ")}</small></span><span>{row.status === "approved" ? "Approved" : "Rejected"}<small>{date(row.reviewedAt)}</small></span></summary>
        <div className={styles.details}>
          <dl><div><dt>Reviewed by</dt><dd>{row.reviewedBy}</dd></div><div><dt>Submitted</dt><dd>{date(row.submittedAt)}</dd></div>
            <div><dt>Contact</dt><dd>{row.contactName}</dd></div><div><dt>Manager email</dt><dd>{row.loginEmail || "Legacy access-code approval"}</dd></div>
            <div><dt>Review notes</dt><dd>{row.reviewNotes || "No notes recorded."}</dd></div></dl>
          {row.canResend ? <div className={styles.resend}>
            <p>Send to {row.loginEmail}. The link stays usable until successful dashboard entry. If the previous link was used, a new link is issued.</p>
            <button type="button" disabled={Boolean(sending)} onClick={() => void resend(row)}>{sending === row.id ? "Sending…" : "Resend dashboard link"}</button>
          </div> : row.status === "approved" ? <p>This older approval uses an access code. Manage access from the club account.</p> : null}
          <h3>Recent resends</h3>
          {row.resends.length ? <ul>{row.resends.map(event => <li key={event.id}>{event.status === "sent" ? "Email sent" : event.status === "failed" ? "Email not sent" : "Delivery not confirmed"} · {date(event.at)} · {event.by}</li>)}</ul> : <p>No recent resends recorded.</p>}
        </div>
      </details>)}
      {!rows.length && <p>No matching approval history.</p>}
      <div className={styles.paging}><button type="button" className="secondary" disabled={filter.page === 0 || Boolean(sending)} onClick={() => setFilter(current => ({ ...current, page: current.page - 1 }))}>Previous</button><button type="button" className="secondary" disabled={!hasMore || Boolean(sending)} onClick={() => setFilter(current => ({ ...current, page: current.page + 1 }))}>Next</button></div>
    </>}
  </section>;
}
