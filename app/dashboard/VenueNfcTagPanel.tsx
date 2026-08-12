"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type NfcTag = {
  id: string;
  venueId: string;
  type: "dressing_room" | "cashier";
  label: string;
  status: "active" | "disabled" | "revoked";
  lastTappedAt: string | null;
  tapCount: number;
  lastScannedAt: string | null;
  scanCount: number;
  createdAt: string;
};

type DancerAffiliation = {
  id: string;
  status: string;
  approvedAt?: string | null;
  dancer?: { stageName?: string; slug?: string; city?: string; avatarUrl?: string | null } | null;
};

export default function VenueNfcTagPanel({
  initialAffiliations = [],
  canManageRoster = false,
  canRequestSupport = false,
}: {
  initialAffiliations?: Array<Record<string, unknown>>;
  canManageRoster?: boolean;
  canRequestSupport?: boolean;
}) {
  const [tags, setTags] = useState<NfcTag[]>([]);
  const [affiliations, setAffiliations] = useState<DancerAffiliation[]>(initialAffiliations as DancerAffiliation[]);
  const [status, setStatus] = useState("Loading assigned NFC stickers…");
  const [isSaving, setIsSaving] = useState(false);
  const [testingTagId, setTestingTagId] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const testBaselineRef = useRef(0);
  const [supportTagId, setSupportTagId] = useState("");
  const [supportType, setSupportType] = useState<"damaged" | "lost" | "relocate" | "replacement">("damaged");
  const [supportNotes, setSupportNotes] = useState("");

  const load = useCallback(async () => {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    try {
      const [tagResponse, rosterResponse] = await Promise.all([
        fetch("/api/venue/nfc-tags", { headers: auth, cache: "no-store" }),
        fetch("/api/venue/dancer-verifications", { headers: auth, cache: "no-store" }),
      ]);
      const [tagData, rosterData] = await Promise.all([tagResponse.json(), rosterResponse.json()]);
      if (!tagResponse.ok || !tagData.ok) throw new Error(tagData.error || "Unable to load assigned NFC stickers.");
      if (!rosterResponse.ok || !rosterData.ok) throw new Error(rosterData.error || "Unable to load the verified dancer roster.");
      persistRefreshedSession(tagData.session);
      setTags(tagData.tags || []);
      setAffiliations(rosterData.affiliations || []);
      setStatus(tagData.tags?.length
        ? ""
        : "No stickers are assigned yet. MyDancr will program and supply this venue's physical NFC stickers.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load assigned NFC stickers.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!testingTagId) return;
    const startedAt = Date.now();
    let cancelled = false;
    async function checkTap() {
      const auth = authHeaders();
      if (!auth) return;
      try {
        const response = await fetch("/api/venue/nfc-tags", { headers: auth, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to check NFC activity.");
        const nextTags = (data.tags || []) as NfcTag[];
        if (!cancelled) setTags(nextTags);
        const tested = nextTags.find((tag) => tag.id === testingTagId);
        if (tested && tested.scanCount > testBaselineRef.current) {
          if (!cancelled) {
            setTestingTagId("");
            setTestStatus(`Test confirmed. ${tested.label} recorded the NFC tap.`);
          }
          return;
        }
        if (Date.now() - startedAt >= 60_000 && !cancelled) {
          setTestingTagId("");
          setTestStatus("No tap was detected within 60 seconds. Try again with the phone unlocked and NFC enabled, or request support.");
        }
      } catch (error) {
        if (!cancelled) {
          setTestingTagId("");
          setTestStatus(error instanceof Error ? error.message : "Unable to check NFC activity.");
        }
      }
    }
    void checkTap();
    const timer = window.setInterval(() => void checkTap(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [testingTagId]);

  async function removeAccess(affiliation: DancerAffiliation) {
    const dancerName = affiliation.dancer?.stageName || "this dancer";
    if (!window.confirm(`Remove ${dancerName} from this venue's NFC-authorized roster? They must tap the dressing-room sticker again before they can check in here.`)) return;
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setIsSaving(true);
    try {
      const response = await fetch("/api/venue/dancer-verifications", {
        method: "DELETE",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ affiliationId: affiliation.id, reason: "Venue removed NFC access." }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove NFC access.");
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(`${dancerName} was removed. A new dressing-room tap restores access.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove NFC access.");
    } finally {
      setIsSaving(false);
    }
  }

  function startTapTest(tag: NfcTag) {
    testBaselineRef.current = tag.scanCount;
    setTestStatus(`Ready to test ${tag.label}. Tap the physical sticker with an unlocked NFC-enabled phone within 60 seconds.`);
    setTestingTagId(tag.id);
  }

  async function sendSupportRequest() {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    if (!supportTagId) return setStatus("Choose an assigned NFC sticker.");
    setIsSaving(true);
    try {
      const response = await fetch("/api/venue/nfc-support", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ tagId: supportTagId, requestType: supportType, notes: supportNotes }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to request NFC support.");
      setStatus(data.message || "NFC support request sent.");
      setSupportTagId("");
      setSupportNotes("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request NFC support.");
    } finally {
      setIsSaving(false);
    }
  }

  const activeAffiliations = affiliations.filter((item) => item.status === "active");

  return (
    <article className="info-panel venue-nfc-panel" id="venue-nfc-tags">
      <div>
        <span className="eyebrow">MyDancr supplied hardware</span>
        <h2>Assigned NFC stickers</h2>
        <p>MyDancr programs and supplies every sticker. This venue installs the labeled stickers and monitors activity here. The dressing-room tap itself authorizes dancer access—no separate manager approval is needed.</p>
      </div>
      <div className="venue-nfc-flow" aria-label="NFC workflow">
        <section><b>1</b><span><strong>Dressing room</strong><small>Dancer taps → venue access is authorized → Working Now starts for six hours. Retaps cannot extend it, and a six-hour cooldown follows.</small></span></section>
        <section><b>2</b><span><strong>Cashier</strong><small>Customer opens a selected Club Deal → taps the cashier sticker → redemption and attribution are recorded.</small></span></section>
      </div>
      <section className="nfc-supply-note" aria-label="NFC sticker support">
        <strong>Installation only</strong>
        <span>Match each supplied sticker to its placement label. Test a physical tap here, or send MyDancr a tracked replacement request if a sticker is lost, damaged, or moved.</span>
      </section>
      <div className="nfc-tag-list" aria-label="Assigned NFC sticker inventory">
        {tags.map((tag) => (
          <section key={tag.id} className={`nfc-tag-row ${tag.status}`}>
            <div>
              <span>{tag.type === "dressing_room" ? "Dressing room" : "Cashier"}</span>
              <strong>{tag.label}</strong>
              <small>{tag.scanCount} physical {tag.scanCount === 1 ? "scan" : "scans"} · {tag.tapCount} completed {tag.tapCount === 1 ? "action" : "actions"}{tag.lastScannedAt ? ` · Last scan ${formatDate(tag.lastScannedAt)}` : " · Not scanned yet"}</small>
            </div>
            <div className="nfc-tag-actions">
              <b>{tag.status}</b>
              {tag.status === "active" ? <button type="button" disabled={Boolean(testingTagId)} onClick={() => startTapTest(tag)}>{testingTagId === tag.id ? "Listening…" : "Test tap"}</button> : null}
              {canRequestSupport ? <button type="button" onClick={() => setSupportTagId(tag.id)}>Get support</button> : null}
            </div>
          </section>
        ))}
      </div>
      {testStatus ? <p className="nfc-test-status" role="status">{testStatus}</p> : null}
      {supportTagId ? (
        <section className="nfc-support-form" aria-label="NFC sticker support request">
          <strong>Request support for {tags.find((tag) => tag.id === supportTagId)?.label || "sticker"}</strong>
          <label>Issue
            <select value={supportType} onChange={(event) => setSupportType(event.target.value as typeof supportType)}>
              <option value="damaged">Damaged</option>
              <option value="lost">Lost</option>
              <option value="relocate">Needs to move</option>
              <option value="replacement">Replacement needed</option>
            </select>
          </label>
          <label>Details<textarea value={supportNotes} maxLength={1000} rows={3} onChange={(event) => setSupportNotes(event.target.value)} /></label>
          <div><button type="button" disabled={isSaving} onClick={() => void sendSupportRequest()}>Send request</button><button type="button" disabled={isSaving} onClick={() => setSupportTagId("")}>Cancel</button></div>
        </section>
      ) : null}
      <section className="venue-nfc-roster" aria-label="Verified dancer roster">
        <div className="venue-nfc-roster-head">
          <span><strong>NFC-authorized dancer roster</strong><small>Authorized by the dressing-room sticker</small></span>
          <b>{activeAffiliations.length} active</b>
        </div>
        {activeAffiliations.length ? activeAffiliations.map((affiliation) => (
          <div className="venue-nfc-dancer" key={affiliation.id}>
            <span><strong>{affiliation.dancer?.stageName || "Dancer"}</strong><small>NFC-authorized{affiliation.approvedAt ? ` · ${formatDate(affiliation.approvedAt)}` : ""}</small></span>
            {canManageRoster ? <button type="button" disabled={isSaving} onClick={() => removeAccess(affiliation)}>Remove access</button> : null}
          </div>
        )) : <p>No dancers have tapped this venue&apos;s dressing-room sticker yet.</p>}
      </section>
      {status ? <p role="status">{status}</p> : null}
      <style>{`
        .venue-nfc-panel{display:grid;gap:16px}.venue-nfc-panel h2,.venue-nfc-panel p{margin:4px 0}.venue-nfc-panel>div>p{color:#b9accd;line-height:1.45}.venue-nfc-flow{display:grid;grid-template-columns:1fr 1fr;gap:9px}.venue-nfc-flow section{display:flex;gap:10px;padding:12px;border:1px solid rgba(114,80,255,.2);border-radius:12px;background:rgba(92,48,190,.07)}.venue-nfc-flow section>b{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;color:#fff;background:#642bd7}.venue-nfc-flow span,.venue-nfc-roster-head span,.venue-nfc-dancer span{display:grid;gap:3px}.venue-nfc-flow small,.venue-nfc-roster small{color:#9e94aa;line-height:1.35}.venue-nfc-panel button{min-height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#f8fafc;background:rgba(255,255,255,.055);font:inherit;font-weight:850;cursor:pointer}.venue-nfc-panel button:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}.venue-nfc-panel button:disabled{opacity:.6;cursor:wait}.nfc-supply-note{display:grid;gap:5px;padding:13px 14px;border:1px solid rgba(34,211,238,.24);border-radius:12px;background:rgba(34,211,238,.05)}.nfc-supply-note strong{color:#a5f3fc}.nfc-supply-note span{color:#a9a0b6;line-height:1.4}.nfc-tag-list{display:grid;gap:8px}.nfc-tag-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}.nfc-tag-row>div{display:grid;gap:2px}.nfc-tag-row span{color:#c4b5fd;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.nfc-tag-row small{color:#938a9f}.nfc-tag-row b{color:#6ee7b7;font-size:10px;text-transform:uppercase}.nfc-tag-row.disabled b,.nfc-tag-row.revoked b{color:#b4aabf}.nfc-tag-actions{display:flex!important;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.nfc-tag-actions button{min-height:34px;font-size:11px}.nfc-test-status{padding:12px 14px;border:1px solid rgba(16,185,129,.3);border-radius:11px;color:#a7f3d0;background:rgba(16,185,129,.06)}.nfc-support-form{display:grid;gap:12px;padding:14px;border:1px solid #334155;border-radius:12px;background:#0b0b10}.nfc-support-form label{display:grid;gap:6px;color:#cbd5e1;font-size:12px;font-weight:850}.nfc-support-form select,.nfc-support-form textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#111118;font:inherit}.nfc-support-form>div{display:flex;gap:8px;flex-wrap:wrap}.venue-nfc-roster{display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}.venue-nfc-roster-head,.venue-nfc-dancer{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-nfc-roster-head>b{padding:6px 9px;border-radius:999px;color:#6ee7b7;background:rgba(16,185,129,.1);font-size:10px}.venue-nfc-dancer{padding:11px 12px;border:1px solid rgba(16,185,129,.16);border-radius:11px;background:rgba(16,185,129,.04)}.venue-nfc-dancer button{min-height:38px}.venue-nfc-roster>p{color:#978da3}@media(max-width:760px){.nfc-tag-row,.venue-nfc-flow{grid-template-columns:1fr}.nfc-tag-actions{justify-content:flex-start}.venue-nfc-dancer{align-items:flex-start;flex-direction:column}}
      `}</style>
    </article>
  );
}

function authHeaders() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.accessToken) return null;
    return {
      authorization: `Bearer ${String(session.accessToken)}`,
      ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
    };
  } catch {
    return null;
  }
}

function persistRefreshedSession(session: unknown) {
  if (!session || typeof session !== "object") return;
  try {
    const current = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null") || {};
    const next = session as Record<string, unknown>;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...current,
      accessToken: typeof next.accessToken === "string" ? next.accessToken : current.accessToken,
      refreshToken: typeof next.refreshToken === "string" ? next.refreshToken : current.refreshToken,
      expiresAt: typeof next.expiresAt === "number" ? next.expiresAt : current.expiresAt,
    }));
  } catch {
    // A storage-restricted browser can continue with the current in-memory request.
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
