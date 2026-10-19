"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAdminAuthenticationError, requestAdminJson } from "./admin-session";
import "./admin-table-qr.css";

type TableCode = { id: string; venue_id: string; kind: "table"; label: string; token: string; active: boolean; updated_at: string };
function isTableCode(value: unknown, venueId: string): value is TableCode {
  if (!value || typeof value !== "object") return false;
  const code = value as TableCode;
  const rowUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tokenUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return code.venue_id === venueId && code.kind === "table" && rowUuid.test(code.id) && tokenUuid.test(code.token)
    && typeof code.label === "string" && typeof code.active === "boolean" && typeof code.updated_at === "string";
}

export default function AdminTableQrCodes({ venueId, name }: { venueId: string; name: string }) {
  const [opened, setOpened] = useState(false);
  const [revision, setRevision] = useState(0);
  const [links, setLinks] = useState<TableCode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<TableCode | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const createAttempt = useRef<{ id: string; label: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [venueId]);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setLoading(true); setStatus(""); setFailed(false); setEditing(null);
    void requestAdminJson(`/api/admin/venues/table-qr?venueId=${encodeURIComponent(venueId)}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      fallbackMessage: "Unable to load table QR codes.",
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || !Array.isArray(data.links) || !data.links.every((code: unknown) => isTableCode(code, venueId))) {
        throw new Error("Table QR codes could not be confirmed.");
      }
      setLinks(data.links);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setLinks(null); setFailed(true); setStatus(error.message || "Unable to load table QR codes.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [venueId, opened, revision]);

  async function mutate(action: "create" | "rename" | "disable", code?: TableCode) {
    if (!links || loading || inFlight.current || !lifetime.current) return;
    const nextLabel = (action === "create" ? label : editLabel).trim();
    if (action !== "disable" && (!nextLabel || nextLabel.length > 60)) return;
    if (action === "disable" && !window.confirm(`Disable ${code?.label}? Its printed QR code will stop working and its open requests will be cancelled.`)) return;
    const controller = lifetime.current;
    inFlight.current = true; setBusy(true); setStatus(""); setFailed(false);
    try {
      if (action === "create" && createAttempt.current?.label !== nextLabel) {
        createAttempt.current = { id: crypto.randomUUID(), label: nextLabel };
      }
      const id = action === "create" ? createAttempt.current!.id : code!.id;
      const data = await requestAdminJson("/api/admin/venues/table-qr", {
        method: "POST", headers: { "content-type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        body: JSON.stringify({ venueId, id, action, label: nextLabel, ...(action === "rename" ? { expectedUpdatedAt: code!.updated_at } : {}) }),
        fallbackMessage: "Unable to save table QR code. Refresh to check its status before trying again.",
      });
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || !isTableCode(data.link, venueId) || data.link.id !== id
        || (action === "disable" ? data.link.active : !data.link.active || data.link.label !== nextLabel)) {
        throw new Error("Table QR save could not be confirmed. Refresh to check its status.");
      }
      setLinks(current => current ? [...current.filter(item => item.id !== id), data.link] : [data.link]);
      if (action === "create") { setLabel(""); createAttempt.current = null; }
      setEditing(null);
      setStatus(action === "disable" ? "Table QR code disabled." : action === "rename" ? "Table label saved." : "Table QR code created.");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAdminAuthenticationError(error)) setLinks(null);
      setFailed(true); setStatus(error instanceof Error ? error.message : "Unable to save table QR code.");
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function copy(code: TableCode) {
    const controller = lifetime.current;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/internal/club/${code.token}`);
      if (controller?.signal.aborted) return;
      setFailed(false); setStatus(`${code.label} link copied.`);
    } catch {
      if (controller?.signal.aborted) return;
      setFailed(true); setStatus("Copy is unavailable. Open the roster and copy its address.");
    }
  }
  async function download(code: TableCode) {
    if (inFlight.current || loading || !lifetime.current) return;
    const controller = lifetime.current;
    inFlight.current = true; setBusy(true); setStatus(""); setFailed(false);
    try {
      const data = await requestAdminJson(`/api/admin/venues/table-qr?venueId=${encodeURIComponent(venueId)}&download=${encodeURIComponent(code.id)}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), fallbackMessage: "Unable to download the QR code.",
      });
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || data.id !== code.id || typeof data.imageDataUrl !== "string" || !data.imageDataUrl.startsWith("data:image/png;base64,")) {
        throw new Error("The QR image could not be confirmed.");
      }
      const anchor = document.createElement("a");
      anchor.href = data.imageDataUrl; anchor.download = `table-qr-${code.id}.png`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setStatus("QR image downloaded.");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAdminAuthenticationError(error)) setLinks(null);
      setFailed(true); setStatus(error instanceof Error ? error.message : "Unable to download the QR code.");
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent) { event.preventDefault(); void mutate("create"); }
  const sorted = links ? [...links].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, undefined, { numeric: true })) : [];
  return <details className="admin-table-qr" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary><strong>Table QR codes</strong>{links ? <span>{links.filter(code => code.active).length} active</span> : null}</summary>
    {opened ? <div className="admin-table-qr-body" aria-label={`${name} table QR codes`}>
      <div className="admin-table-qr-heading"><h3>{name}</h3><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
      {loading ? <p role="status">Loading table QR codes...</p> : null}
      {links ? <>
        <form className="admin-table-qr-create" onSubmit={submit}>
          <label>Table label<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Table 1" maxLength={60} required disabled={busy || loading} /></label>
          <button type="submit" disabled={busy || loading || !label.trim()}>Create QR code</button>
        </form>
        <ul className="admin-table-qr-list">{sorted.map(code => <li key={code.id}>
          <div className="admin-table-qr-identity"><strong>{code.label}</strong><span className={code.active ? "active" : ""}>{code.active ? "Active" : "Disabled"}</span></div>
          {editing?.id === code.id ? <form className="admin-table-qr-rename" onSubmit={event => { event.preventDefault(); void mutate("rename", editing); }}>
            <label>Table label<input value={editLabel} onChange={event => setEditLabel(event.target.value)} maxLength={60} required disabled={busy || loading} /></label>
            <button type="submit" disabled={busy || loading || !editLabel.trim()}>Save label</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </form> : code.active ? <div className="admin-table-qr-actions">
            <button type="button" disabled={busy || loading} onClick={() => void download(code)}>Download QR</button>
            <a href={`/internal/sign/${code.token}`} target="_blank" rel="noopener noreferrer">Print QR sign</a>
            <a href={`/internal/club/${code.token}`} target="_blank" rel="noopener noreferrer">Open roster</a>
            <button type="button" disabled={busy || loading} onClick={() => void copy(code)}>Copy link</button>
            <button type="button" disabled={busy || loading} onClick={() => { setEditing(code); setEditLabel(code.label); }}>Rename</button>
            <button type="button" className="admin-table-qr-disable" disabled={busy || loading} onClick={() => void mutate("disable", code)}>Disable</button>
          </div> : null}
        </li>)}</ul>
        {!sorted.length && !loading ? <p>No table QR codes yet.</p> : null}
      </> : !loading ? <button type="button" onClick={() => setRevision(value => value + 1)}>Retry loading codes</button> : null}
      {busy ? <p role="status">Working...</p> : null}
      {status ? <p role={failed ? "alert" : "status"}>{status}</p> : null}
    </div> : null}
  </details>;
}
