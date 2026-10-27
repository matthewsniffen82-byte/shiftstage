"use client";
import { useEffect, useRef, useState } from "react";
import { requestAdminJson } from "./admin-session";
import { existingTableNumbers, readTableQrRange } from "./admin-table-qr-range";
import "./admin-table-qr.css";

type Tag = { id: string; uid: string; status: string; generation: string; verified_at: string | null };
type Table = { id: string; venue_id: string; label: string; active: boolean; updated_at: string; tag: Tag | null };
type Programming = { uid: string; url: string; ndefHex: string; adminKey: string; metaKey: string; fileKey: string; piccOffset: number; macOffset: number; macInputOffset: number; fileOption: string; accessRights: string; sdmOptions: string; sdmAccessRights: string };
export default function AdminInternalNfcTables({ venueId, name }: { venueId: string; name: string }) {
  const [opened, setOpened] = useState(false), [revision, setRevision] = useState(0);
  const [links, setLinks] = useState<Table[] | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [label, setLabel] = useState(""), [rangeMode, setRangeMode] = useState(false), [first, setFirst] = useState("1"), [last, setLast] = useState("20");
  const [selected, setSelected] = useState(""), [uid, setUid] = useState(""), [programming, setProgramming] = useState<Programming | null>(null);
  const pending = useRef(false), attempt = useRef<{ label: string; id: string } | null>(null), lifetime = useRef<AbortController | null>(null);
  const base = "/api/admin/venues/internal-nfc";
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [venueId]);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void requestAdminJson(`${base}?venueId=${encodeURIComponent(venueId)}`, { cache: "no-store", signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId || !Array.isArray(data.links)) throw new Error("Unable to confirm table setup.");
      setLinks(data.links.map((link: Table & { tag: Tag | Tag[] | null }) => ({ ...link, tag: Array.isArray(link.tag) ? link.tag[0] || null : link.tag })));
    }).catch(reason => { if (!controller.signal.aborted) { setLinks(null); setMessage(reason.message); } });
    return () => controller.abort();
  }, [venueId, opened, revision]);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (reason) { if (!lifetime.current?.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Unable to save. Refresh setup and try again."); }
    finally { pending.current = false; if (!lifetime.current?.signal.aborted) { setBusy(false); setRevision(value => value + 1); } }
  }
  const post = (path: string, body: object) => requestAdminJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([lifetime.current!.signal, AbortSignal.timeout(15000)]) });
  async function createTables() {
    if (!links) return;
    const range = rangeMode ? readTableQrRange(first, last).range : null;
    if (rangeMode && !range || !rangeMode && !label.trim()) return;
    const names = range ? Array.from({ length: range.count }, (_, index) => `Table ${range.start + index}`) : [label.trim()];
    const existing = range ? existingTableNumbers(range, links) : new Set<number>();
    let done = 0;
    for (const nextLabel of names) {
      if (lifetime.current?.signal.aborted) return;
      if (range && existing.has(Number(nextLabel.slice(6)))) continue;
      if (attempt.current?.label !== nextLabel) attempt.current = { id: crypto.randomUUID(), label: nextLabel };
      await post("/api/admin/venues/table-qr", { venueId, action: "create", ...attempt.current });
      attempt.current = null; done++; setMessage(`${done} table assignments created…`);
    }
    setLabel(""); setMessage(`${done} table assignments created. Assign and program each sticker below.`);
  }
  async function action(table: Table, action: string) {
    const data = await post(base, { venueId, linkId: table.id, action, uid, generation: table.tag?.generation });
    if (action === "preview") { window.location.assign(data.href); return; }
    if (data.programming) { setSelected(table.id); setProgramming(data.programming); setMessage("Programming settings ready. Keep the keys private."); }
    else { setProgramming(null); setMessage(action === "activate" ? "Sticker active. Each visit lasts 10 hours." : "Sticker disabled. Its customer sessions are revoked."); }
  }
  return <details className="admin-table-qr" onToggle={event => { if (event.currentTarget.open) setOpened(true); else { setProgramming(null); setSelected(""); } }}>
    <summary><strong>Table NFC stickers</strong></summary>
    {opened ? <div className="admin-table-qr-body" aria-label={`${name} table NFC stickers`}>
      <div className="admin-table-qr-heading"><h3>{name}</h3><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
      <p>NTAG 424 DNA · 10 hours per visit · No location permission. Customers need a verified tap; old QR links no longer grant access.</p>
      {message ? <p role="status">{message}</p> : null}
      {!links ? <p>Loading table assignments…</p> : <>
        <div className="admin-table-qr-mode"><button type="button" aria-pressed={!rangeMode} disabled={busy} onClick={() => setRangeMode(false)}>Single table</button><button type="button" aria-pressed={rangeMode} disabled={busy} onClick={() => setRangeMode(true)}>Number range</button></div>
        <form className="admin-table-qr-create" onSubmit={event => { event.preventDefault(); void run(createTables); }}>
          {rangeMode ? <><label>First table<input inputMode="numeric" value={first} onChange={event => setFirst(event.target.value)} disabled={busy} required /></label><label>Last table<input inputMode="numeric" value={last} onChange={event => setLast(event.target.value)} disabled={busy} required /></label></> : <label>Table label<input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} placeholder="Table 1" disabled={busy} required /></label>}
          <button type="submit" disabled={busy || (rangeMode ? !readTableQrRange(first, last).range : !label.trim())}>Create table{rangeMode ? "s" : ""}</button>
        </form>
        {rangeMode ? <p>{readTableQrRange(first, last).error || "Existing table numbers are kept. Each new table needs its own sticker."}</p> : null}
        <ul className="admin-table-qr-list">{[...links].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map(table => <li key={table.id}>
          <div className="admin-table-qr-identity"><strong>{table.label}</strong><span>{!table.active ? "Table disabled" : table.tag?.status === "active" ? "Active · 10 hours" : table.tag?.status === "disabled" ? "Sticker disabled" : table.tag?.verified_at ? "Test passed · ready to activate" : table.tag ? "Needs programming / test" : "No sticker assigned"}</span></div>
          {table.active ? <>
            <div className="admin-table-qr-actions">
              <button type="button" disabled={busy} onClick={() => { setSelected(table.id); setUid(table.tag?.uid || ""); setProgramming(null); }}>Sticker setup</button>
              <button type="button" disabled={busy} onClick={() => void run(() => action(table, "preview"))}>Preview grid</button>
              {table.tag?.status === "active" ? <button type="button" disabled={busy} onClick={() => void run(() => action(table, "disable"))}>Disable sticker</button> : table.tag?.verified_at ? <button type="button" disabled={busy} onClick={() => void run(() => action(table, "activate"))}>Activate sticker</button> : null}
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                const next = window.prompt("Table label", table.label)?.trim(); if (!next || next === table.label) return;
                await post("/api/admin/venues/table-qr", { venueId, id: table.id, action: "rename", label: next, expectedUpdatedAt: table.updated_at });
                setMessage("Table label saved.");
              })}>Rename table</button>
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                if (!window.confirm(`Disable ${table.label}, revoke its access and cancel its open requests?`)) return;
                await post("/api/admin/venues/table-qr", { venueId, id: table.id, action: "disable" }); setProgramming(null); setMessage("Table disabled.");
              })}>Disable table</button>
            </div>
            {selected === table.id ? <div className="admin-table-qr-body">
              {!table.tag ? <form className="admin-table-qr-create" onSubmit={event => { event.preventDefault(); void run(() => action(table, "prepare")); }}><label>Sticker UID<input value={uid} onChange={event => setUid(event.target.value)} placeholder="04… (14 hex characters)" maxLength={30} disabled={busy} required /></label><button type="submit" disabled={busy || !uid.trim()}>Prepare sticker</button></form> : <><p>UID: {table.tag.uid}</p><button type="button" disabled={busy} onClick={() => void run(() => action(table, "settings"))}>Show programming settings</button></>}
              <ol><li>Read the NTAG 424 DNA UID with your NFC reader and assign it here.</li><li>Use an NTAG 424 DNA SDM programmer to apply the private settings. Writing only the URL in NFC Tools is not enough.</li><li>Tap the programmed sticker on a phone and choose Open club. It must show Sticker verified.</li><li>Refresh this list, activate the sticker, then tap it again to check the grid.</li></ol>
              {programming ? <details open><summary>Private programming settings</summary>
                <p>Use AES mode, NDEF file 02, free read and Key 0 for write/change. Set Key 1 to metaKey, Key 2 to fileKey, and protect Key 0 with adminKey. Keep these keys private. The NDEF bytes include NLEN and an uncompressed URI; do not change the encoding or offsets.</p>
                <label>Settings for your programmer<textarea readOnly rows={10} value={JSON.stringify(programming, null, 2)} onFocus={event => event.currentTarget.select()} style={{ width: "100%", boxSizing: "border-box", fontSize: 12 }} /></label>
                <button type="button" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(programming, null, 2)).then(() => setMessage("Settings copied.")).catch(() => setMessage("Select the settings above, then use your device’s Copy command.")); }}>Copy settings</button>
                <button type="button" onClick={() => setProgramming(null)}>Hide keys</button>
              </details> : null}
            </div> : null}
          </> : null}
        </li>)}</ul>
        {!links.length ? <p>No table stickers yet.</p> : null}
      </>}
    </div> : null}
  </details>;
}
