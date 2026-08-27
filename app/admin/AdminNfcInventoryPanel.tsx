"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { requestAdminJson } from "./admin-session";

type VenueOption = {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string | null;
  isClaimed: boolean;
};

type AdminNfcTag = {
  id: string;
  venueId: string;
  type: "dressing_room" | "cashier";
  label: string;
  status: "active" | "disabled" | "revoked";
  lastTappedAt: string | null;
  tapCount: number;
  createdAt: string;
  venue: Pick<VenueOption, "id" | "name" | "slug" | "city" | "state">;
};

export default function AdminNfcInventoryPanel() {
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [tags, setTags] = useState<AdminNfcTag[]>([]);
  const [venueId, setVenueId] = useState("");
  const [type, setType] = useState<AdminNfcTag["type"]>("dressing_room");
  const [label, setLabel] = useState("Dressing room");
  const [status, setStatus] = useState("Loading MyDancr NFC inventory…");
  const [isLoading, setIsLoading] = useState(true);
  const [programmingUrl, setProgrammingUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        cache: "no-store",
        fallbackMessage: "Unable to load NFC inventory.",
      });
      setVenues(data.venues || []);
      setTags(data.tags || []);
      setVenueId((current) => current || data.venues?.[0]?.id || "");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load NFC inventory.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount = useMemo(() => tags.filter((tag) => tag.status === "active").length, [tags]);

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, type, label }),
        fallbackMessage: "Unable to assign NFC sticker.",
      });
      setProgrammingUrl(data.programmingUrl || "");
      setStatus(data.message || "Sticker assigned.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to assign NFC sticker.");
    } finally {
      setIsSaving(false);
    }
  }

  async function update(tag: AdminNfcTag, action: "enable" | "disable" | "rotate") {
    if (action === "rotate" && !window.confirm(`Revoke ${tag.venue.name} · ${tag.label} and issue a replacement programming URL?`)) return;
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: tag.id, action }),
        fallbackMessage: "Unable to update NFC sticker.",
      });
      setProgrammingUrl(data.programmingUrl || "");
      setStatus(data.message || "Sticker updated.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update NFC sticker.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyProgrammingUrl() {
    try {
      await navigator.clipboard.writeText(programmingUrl);
      setStatus("Programming URL copied. Write one NDEF URL record, test it, then lock the sticker read-only.");
    } catch {
      setStatus("Copy failed. Select the programming URL manually.");
    }
  }

  return (
    <div className="admin-nfc-inventory">
      <div className="admin-nfc-summary">
        <span><strong>{isLoading && !tags.length ? "…" : activeCount}</strong><small>active supplied stickers</small></span>
        <span><strong>{isLoading && !venues.length ? "…" : venues.length}</strong><small>active venues</small></span>
      </div>
      <p className="admin-nfc-intro">MyDancr owns provisioning. Program, test, label, and lock each physical sticker before it is delivered to the assigned venue.</p>
      <form onSubmit={provision}>
        <label>Assigned venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={isLoading || isSaving || !venues.length} required>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}{venue.isClaimed ? "" : " · account not claimed"}</option>
            ))}
          </select>
        </label>
        <label>Placement
          <select value={type} onChange={(event) => {
            const next = event.target.value as AdminNfcTag["type"];
            setType(next);
            setLabel(next === "dressing_room" ? "Dressing room" : "Main cashier");
          }}>
            <option value="dressing_room">Dressing room — dancer authorization</option>
            <option value="cashier">Cashier — Club Deal redemption</option>
          </select>
        </label>
        <label>Sticker label
          <input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={80} required />
        </label>
        <button type="submit" disabled={isSaving || !venueId}>{isSaving ? "Working…" : "Assign sticker"}</button>
      </form>
      {programmingUrl ? (
        <section className="admin-nfc-programming" aria-label="One-time NFC programming URL">
          <strong>Shown once — program the physical sticker now</strong>
          <code>{programmingUrl}</code>
          <button type="button" onClick={copyProgrammingUrl}>Copy programming URL</button>
          <small>Do not send this URL to venue staff. Test on iPhone and Android, label the placement, then permanently lock the NDEF record.</small>
        </section>
      ) : null}
      <div className="admin-nfc-list">
        {tags.map((tag) => (
          <section className={`admin-nfc-row ${tag.status}`} key={tag.id}>
            <span>
              <strong>{tag.venue.name} · {tag.label}</strong>
              <small>{tag.type === "dressing_room" ? "Dressing room" : "Cashier"} · {tag.tapCount} taps{tag.lastTappedAt ? ` · Last ${formatDate(tag.lastTappedAt)}` : " · Not tapped"}</small>
            </span>
            <b>{tag.status}</b>
            {tag.status !== "revoked" ? (
              <div>
                <button type="button" disabled={isSaving} onClick={() => update(tag, tag.status === "active" ? "disable" : "enable")}>{tag.status === "active" ? "Disable" : "Enable"}</button>
                <button type="button" disabled={isSaving} onClick={() => update(tag, "rotate")}>Replace</button>
              </div>
            ) : null}
          </section>
        ))}
        {!isLoading && !tags.length ? <p>No NFC stickers have been assigned.</p> : null}
      </div>
      {status ? <p role="status" className="admin-nfc-status">{status}</p> : null}
      <style>{`
        .admin-nfc-inventory,.admin-nfc-list{display:grid;gap:10px}.admin-nfc-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px}.admin-nfc-summary span{display:grid;gap:2px;padding:11px;border:1px solid rgba(148,229,255,.16);border-radius:8px;background:rgba(148,229,255,.05)}.admin-nfc-summary strong{color:#fff;font-size:24px}.admin-nfc-summary small,.admin-nfc-intro,.admin-nfc-row small{color:#b9accd}.admin-nfc-intro{margin:0;line-height:1.45}.admin-nfc-inventory form{display:grid;gap:9px}.admin-nfc-inventory label{display:grid;gap:6px;color:#d8cfeb;font-size:12px;font-weight:850}.admin-nfc-inventory input,.admin-nfc-inventory select{width:100%;min-height:42px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;background:#17141d;font:inherit}.admin-nfc-inventory button{min-height:40px;padding:8px 11px;border:1px solid rgba(148,229,255,.24);border-radius:8px;color:#fff;background:rgba(96,43,220,.3);font:inherit;font-weight:900;cursor:pointer}.admin-nfc-inventory button:disabled{opacity:.55;cursor:wait}.admin-nfc-programming{display:grid;gap:8px;padding:12px;border:1px solid rgba(50,255,164,.3);border-radius:8px;background:rgba(50,255,164,.07)}.admin-nfc-programming code{padding:9px;border-radius:6px;color:#c7ffe3;background:#070a08;overflow-wrap:anywhere}.admin-nfc-programming small{color:#9db5a8;line-height:1.4}.admin-nfc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:11px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(255,255,255,.035)}.admin-nfc-row>span{display:grid;gap:3px}.admin-nfc-row>b{color:#7dffbd;font-size:10px;text-transform:uppercase}.admin-nfc-row.disabled>b,.admin-nfc-row.revoked>b{color:#b9accd}.admin-nfc-row>div{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:7px}.admin-nfc-status{margin:0;color:#94e5ff;line-height:1.4}@media(max-width:680px){.admin-nfc-summary{grid-template-columns:1fr}.admin-nfc-row{grid-template-columns:1fr}.admin-nfc-row>b{justify-self:start}}
      `}</style>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
