"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestAdminJson } from "./admin-session";

type VenueOption = {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string | null;
  isClaimed: boolean;
  isPublished: boolean;
};

type AdminNfcTag = {
  id: string;
  venueId: string;
  type: "dressing_room";
  label: string;
  status: "active" | "disabled" | "revoked";
  lastTappedAt: string | null;
  tapCount: number;
  createdAt: string;
  venue: Pick<VenueOption, "id" | "name" | "slug" | "city" | "state">;
};

export default function AdminNfcInventoryPanel({ scopedVenueId = "" }: { scopedVenueId?: string } = {}) {
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [tags, setTags] = useState<AdminNfcTag[]>([]);
  const [venueId, setVenueId] = useState(scopedVenueId);
  const [label, setLabel] = useState("Dancer Check-In Tag");
  const [status, setStatus] = useState("Loading MyDancr check-in tag inventory…");
  const [isLoading, setIsLoading] = useState(true);
  const [programmingUrl, setProgrammingUrl] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "manual">("idle");
  const programmingFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  const load = useCallback(async ({ clearStatus = true } = {}) => {
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (mountedRef.current) setIsLoading(true);
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        cache: "no-store",
        signal: controller.signal,
        fallbackMessage: "Unable to load check-in tag inventory.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      const availableVenues: VenueOption[] = (data.venues || []).filter((venue: VenueOption) => !scopedVenueId || venue.id === scopedVenueId);
      setVenues(availableVenues);
      setTags((data.tags || []).filter((tag: AdminNfcTag) => tag.type === "dressing_room" && (!scopedVenueId || tag.venueId === scopedVenueId)));
      setVenueId((current) => availableVenues.some((venue) => venue.id === current) ? current : availableVenues[0]?.id || "");
      if (clearStatus) setStatus("");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to load check-in tag inventory.");
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (mountedRef.current && requestId === loadSequenceRef.current) setIsLoading(false);
    }
  }, [scopedVenueId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      actionSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, [load]);

  const activeCount = useMemo(() => tags.filter((tag) => tag.status === "active").length, [tags]);
  const selectedVenue = venues.find((venue) => venue.id === venueId && (!scopedVenueId || venue.id === scopedVenueId));
  const canProvision = !isLoading && !isSaving && Boolean(selectedVenue);

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mountedRef.current || actionInFlightRef.current || !canProvision) return;
    actionInFlightRef.current = true;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setIsSaving(true);
    setCopyState("idle");
    setProgrammingUrl("");
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, type: "dressing_room", label }),
        fallbackMessage: "Unable to assign check-in tag.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setProgrammingUrl(data.programmingUrl || "");
      setStatus(data.message || "Tag assigned.");
      await load({ clearStatus: false });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to assign check-in tag.");
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (requestId === actionSequenceRef.current) actionInFlightRef.current = false;
      if (mountedRef.current && requestId === actionSequenceRef.current) setIsSaving(false);
    }
  }

  async function update(tag: AdminNfcTag, action: "enable" | "disable" | "rotate") {
    if (action === "rotate" && !window.confirm(`Revoke ${tag.venue.name} · ${tag.label} and issue a replacement programming URL?`)) return;
    if (!mountedRef.current || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setIsSaving(true);
    setCopyState("idle");
    setProgrammingUrl("");
    try {
      const data = await requestAdminJson("/api/admin/nfc-tags", {
        method: "PATCH",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: tag.id, action }),
        fallbackMessage: "Unable to update check-in tag.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setProgrammingUrl(data.programmingUrl || "");
      setStatus(data.message || "Tag updated.");
      await load({ clearStatus: false });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to update check-in tag.");
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (requestId === actionSequenceRef.current) actionInFlightRef.current = false;
      if (mountedRef.current && requestId === actionSequenceRef.current) setIsSaving(false);
    }
  }

  async function copyProgrammingUrl() {
    const field = programmingFieldRef.current;
    if (!programmingUrl || !field || copyState === "copying") return;
    const actionId = actionSequenceRef.current;
    setCopyState("copying");
    let copied = false;
    try {
      // Keep selection-based copying inside the original tap for mobile browsers.
      selectProgrammingUrl(field);
      copied = document.execCommand("copy");
    } catch {
      // Some browsers only support the asynchronous clipboard API.
    }
    if (!copied) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(programmingUrl);
          copied = true;
        }
      } catch {
        // The visible, selected field remains available for native manual copy.
      }
    }
    if (!mountedRef.current || actionId !== actionSequenceRef.current || programmingFieldRef.current !== field) return;
    setCopyState(copied ? "copied" : "manual");
  }

  return (
    <div className="admin-nfc-inventory">
      <div className="admin-nfc-summary">
        <span><strong>{isLoading && !tags.length ? "…" : activeCount}</strong><small>active supplied tags</small></span>
        <span><strong>{isLoading && !venues.length ? "…" : venues.length}</strong><small>clubs available for setup</small></span>
      </div>
      <p className="admin-nfc-intro">Dancer Check-In Tags authorize dancers and check them in. MyDancr programs, tests, labels, and locks each physical tag before delivery.</p>
      <details className="admin-nfc-instructions">
        <summary>How to program an NFC tag</summary>
        <ol>
          <li>Choose the club, label the dancer check-in tag, and select <strong>Assign tag</strong>.</li>
          <li>Copy the programming URL shown below.</li>
          <li>In NFC Tools on your phone, choose <strong>Write → Add a record → URL / URI</strong>, paste the link, then choose <strong>Write</strong> and hold your phone against the tag.</li>
          <li>Once the club is published, tap the tag on iPhone and Android to check it opens the correct club. Lock it read-only only after testing.</li>
          <li>Print <strong>Dancer Check-In Tag</strong> and <strong>Tap to check in with MyDancr.</strong> on the physical tag.</li>
        </ol>
      </details>
      <form onSubmit={provision}>
        <label>Assigned venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={Boolean(scopedVenueId) || isLoading || isSaving || !venues.length} required>
            {!venues.length ? <option value="">{isLoading ? "Loading clubs…" : "No club available"}</option> : null}
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}{venue.isPublished ? "" : " · not published"}{venue.isClaimed ? "" : " · account not claimed"}</option>
            ))}
          </select>
        </label>
        {selectedVenue && !selectedVenue.isPublished ? <p className="admin-nfc-intro">You can program dancer check-in tags for this club now. Dancer check-in will work after the club is published. Wait until then to test and permanently lock the tag.</p> : null}
        <label>Tag label
          <input value={label} disabled={isSaving} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={80} required />
        </label>
        <button type="submit" disabled={!canProvision}>{isSaving ? "Working…" : "Assign tag"}</button>
      </form>
      {programmingUrl ? (
        <section className="admin-nfc-programming" aria-label="One-time tag setup link">
          <strong>Shown once — program the physical tag now</strong>
          <label>Programming URL
            <textarea ref={programmingFieldRef} value={programmingUrl} readOnly rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" onFocus={(event) => selectProgrammingUrl(event.currentTarget)} onClick={(event) => selectProgrammingUrl(event.currentTarget)} />
          </label>
          <button type="button" onClick={copyProgrammingUrl} disabled={copyState === "copying"}>{copyState === "copied" ? "Copied!" : copyState === "copying" ? "Copying…" : "Copy programming URL"}</button>
          {copyState === "copied" ? <p role="status" className="admin-nfc-status">Programming URL copied. Paste it into NFC Tools.</p> : null}
          {copyState === "manual" ? <p role="status" className="admin-nfc-status">Your browser blocked automatic copying. Press and hold the selected link above, then choose Copy.</p> : null}
          <small>Do not send this URL to venue staff. Test on iPhone and Android, label the placement, then permanently lock the NDEF record.</small>
        </section>
      ) : null}
      <div className="admin-nfc-list">
        {tags.map((tag) => (
          <section className={`admin-nfc-row ${tag.status}`} key={tag.id}>
            <span>
              <strong>{tag.venue.name} · {tag.label}</strong>
              <small>Dancer Check-In Tag · {tag.tapCount} taps{tag.lastTappedAt ? ` · Last ${formatDate(tag.lastTappedAt)}` : " · Not tapped"}</small>
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
        {!isLoading && !tags.length ? <p>No check-in tags have been assigned.</p> : null}
      </div>
      {status ? <p role="status" className="admin-nfc-status">{status}</p> : null}
      <style>{`
        .admin-nfc-programming textarea{box-sizing:border-box;width:100%;min-width:0;padding:9px;border:1px solid rgba(50,255,164,.3);border-radius:6px;color:#c7ffe3;background:#070a08;font:16px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;resize:vertical;-webkit-user-select:text;user-select:text}
        .admin-nfc-instructions{color:var(--dancr-color-text-muted);font-size:13px;line-height:1.5}.admin-nfc-instructions summary{cursor:pointer;color:#fff;font-weight:700}.admin-nfc-instructions ol{margin:8px 0;padding-left:22px}.admin-nfc-instructions li+li{margin-top:6px}
        .admin-nfc-inventory,.admin-nfc-list{display:grid;gap:10px}.admin-nfc-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px}.admin-nfc-summary span{display:grid;gap:2px;padding:11px;border:1px solid rgba(148,229,255,.16);border-radius:8px;background:rgba(148,229,255,.05)}.admin-nfc-summary strong{color:#fff;font-size:24px}.admin-nfc-summary small,.admin-nfc-intro,.admin-nfc-row small{color:var(--dancr-color-text-muted)}.admin-nfc-intro{margin:0;line-height:1.45}.admin-nfc-inventory form{display:grid;gap:9px}.admin-nfc-inventory label{display:grid;gap:6px;color:var(--dancr-color-text-primary);font-size:12px;font-weight:850}.admin-nfc-inventory input,.admin-nfc-inventory select{width:100%;min-height:42px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;background:var(--dancr-color-control-secondary);font:inherit}.admin-nfc-inventory button{min-height:40px;padding:8px 11px;border:1px solid rgba(148,229,255,.24);border-radius:8px;color:#fff;background:rgba(48, 48, 56, 0.3);font:inherit;font-weight:900;cursor:pointer}.admin-nfc-inventory button:disabled{opacity:.55;cursor:wait}.admin-nfc-programming{display:grid;gap:8px;padding:12px;border:1px solid rgba(50,255,164,.3);border-radius:8px;background:rgba(50,255,164,.07)}.admin-nfc-programming code{padding:9px;border-radius:6px;color:#c7ffe3;background:#070a08;overflow-wrap:anywhere}.admin-nfc-programming small{color:#9db5a8;line-height:1.4}.admin-nfc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:11px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(255,255,255,.035)}.admin-nfc-row>span{display:grid;gap:3px}.admin-nfc-row>b{color:#7dffbd;font-size:10px;text-transform:uppercase}.admin-nfc-row.disabled>b,.admin-nfc-row.revoked>b{color:var(--dancr-color-text-muted)}.admin-nfc-row>div{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:7px}.admin-nfc-status{margin:0;color:#94e5ff;line-height:1.4}@media(max-width:680px){.admin-nfc-summary{grid-template-columns:1fr}.admin-nfc-row{grid-template-columns:1fr}.admin-nfc-row>b{justify-self:start}}
      `}</style>
    </div>
  );
}

function selectProgrammingUrl(field: HTMLTextAreaElement) {
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, field.value.length);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
