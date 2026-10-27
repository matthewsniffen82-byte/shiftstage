"use client";
import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";
import type { StaffRole, Workspace } from "@/src/lib/dancr/admin-workspace-policy";
export type WorkspaceAccess = { userId: string; role: StaffRole; workspaces: Workspace[]; venues: Array<Record<string, unknown>>; staff: Array<{ id: string; email: string; display_name: string; admin_workspace_role: StaffRole }> };
type SearchResult = { type: string; id: string; label: string; detail: string; venueId?: string };
export function AdminGlobalSearch({ onOpen }: { onOpen?: (result: SearchResult) => void }) {
  const [q, setQ] = useState(""), [results, setResults] = useState<SearchResult[]>([]), [error, setError] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (q.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(() => void requestAdminJson(`/api/admin/search?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setResults(data.results); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); }), 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);
  return <div className="admin-global-search"><label>Search MyDancr<input type="search" placeholder="Dancer, club, account email or table" value={q} onChange={e => setQ(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {q.length > 1 && <ul aria-label="Search results">{results.map(result => <li key={`${result.type}:${result.id}`}><button type="button" onClick={() => { setSelected(result); setQ(""); onOpen?.(result); }}><strong>{result.label}</strong><small>{result.type} · {result.detail}</small></button></li>)}</ul>}
    {selected?.type === "account" && <aside><strong>{selected.label}</strong><p>{selected.detail}</p><button type="button" onClick={() => setSelected(null)}>Close account details</button></aside>}
  </div>;
}
export function AdminStaffPermissions({ access, onSaved }: { access: WorkspaceAccess; onSaved: (message: string) => void }) {
  const [staff, setStaff] = useState(access.staff), [draft, setDraft] = useState<Record<string, StaffRole>>({});
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  async function save(id: string) {
    setBusy(id); setError("");
    try { await requestAdminJson("/api/admin/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, role: draft[id] }) });
      setStaff(rows => rows.map(row => row.id === id ? { ...row, admin_workspace_role: draft[id] } : row));
      setDraft(values => { const next = { ...values }; delete next[id]; return next; }); onSaved("Staff permissions saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save permissions."); } finally { setBusy(""); }
  }
  return <section><p>Owner: all sections. Content reviewer: media approval. Support: inbox and account search. Billing: venue subscription roster.</p>{error && <p role="alert">{error}</p>}
    {staff.map(person => <div className="admin-staff-row" key={person.id}><strong>{person.display_name || person.email}</strong><span>{person.email}</span>
      <label>Staff role<select disabled={Boolean(busy) || person.id === access.userId} value={draft[person.id] || person.admin_workspace_role} onChange={e => setDraft(values => ({ ...values, [person.id]: e.target.value as StaffRole }))}>
        <option value="owner">Owner</option><option value="reviewer">Content reviewer</option><option value="support">Support</option><option value="billing">Billing</option></select></label>
      {draft[person.id] && <><span>Unsaved change</span><button type="button" disabled={Boolean(busy)} onClick={() => void save(person.id)}>Save</button><button type="button" disabled={Boolean(busy)} onClick={() => setDraft(values => { const next = { ...values }; delete next[person.id]; return next; })}>Cancel</button></>}
    </div>)}</section>;
}
export function AdminUrgentWork({ onOpen }: { onOpen: (workspace: Workspace, panel?: string) => void }) {
  const [data, setData] = useState<{ ready: number; overdue: number; stalled: number; setups: number; checkedAt: string } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const load = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try { const result = await requestAdminJson("/api/admin/workspace/summary", { signal: controller.signal }); if (!controller.signal.aborted) { setData(result); setError(""); } }
      catch { if (!controller.signal.aborted) setError("Urgent counts could not refresh. Showing the last confirmed totals."); } finally { pending = false; }
    };
    void load(); const timer = setInterval(() => void load(), 60000);
    window.addEventListener(ADMIN_DATA_CHANGED, load);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener(ADMIN_DATA_CHANGED, load); };
  }, []);
  const delays = ([['overdue', 'Media waiting over 24 hours'], ['stalled', 'File preparation stalled']] as const)
    .filter(([key]) => data && data[key] > 0);
  if (data && !delays.length && !error) return null;
  return <section className="admin-media-delays" aria-label="Media delays">
    {!data && !error && <p role="status">Checking media delays…</p>}
    {delays.map(([key, label]) => <button type="button" key={key} onClick={() => onOpen("approvals", "admin-media-workbench")}>
      <span>{label}</span><strong>{data?.[key]}</strong><span aria-hidden="true">→</span>
    </button>)}
    {error && <p role="status">{error}</p>}
  </section>;
}
