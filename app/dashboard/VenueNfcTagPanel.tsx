"use client";

import { useCallback, useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type NfcTag = {
  id: string;
  venueId: string;
  type: "dressing_room" | "cashier";
  label: string;
  status: "active" | "disabled" | "revoked";
  lastTappedAt: string | null;
  tapCount: number;
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
}: {
  initialAffiliations?: Array<Record<string, unknown>>;
}) {
  const [tags, setTags] = useState<NfcTag[]>([]);
  const [affiliations, setAffiliations] = useState<DancerAffiliation[]>(initialAffiliations as DancerAffiliation[]);
  const [type, setType] = useState<NfcTag["type"]>("dressing_room");
  const [label, setLabel] = useState("Dressing room");
  const [status, setStatus] = useState("Loading venue NFC tags…");
  const [programmingUrl, setProgrammingUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    try {
      const [tagResponse, rosterResponse] = await Promise.all([
        fetch("/api/venue/nfc-tags", { headers: auth, cache: "no-store" }),
        fetch("/api/venue/dancer-verifications", { headers: auth, cache: "no-store" }),
      ]);
      const [tagData, rosterData] = await Promise.all([tagResponse.json(), rosterResponse.json()]);
      if (!tagResponse.ok || !tagData.ok) throw new Error(tagData.error || "Unable to load NFC tags.");
      if (!rosterResponse.ok || !rosterData.ok) throw new Error(rosterData.error || "Unable to load the NFC-authorized roster.");
      persistRefreshedSession(tagData.session);
      setTags(tagData.tags || []);
      setAffiliations(rosterData.affiliations || []);
      setStatus(tagData.tags?.length ? "" : "Create the first tag, then write its one-time URL to a physical NFC sticker.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load NFC tags.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const response = await fetch("/api/venue/nfc-tags", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ type, label }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to create NFC tag.");
      persistRefreshedSession(data.session);
      setProgrammingUrl(data.programmingUrl);
      setStatus(data.message);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create NFC tag.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateTag(tagId: string, action: "enable" | "disable" | "rotate") {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const response = await fetch("/api/venue/nfc-tags", {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ tagId, action }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update NFC tag.");
      persistRefreshedSession(data.session);
      if (data.programmingUrl) setProgrammingUrl(data.programmingUrl);
      setStatus(data.message);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update NFC tag.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyProgrammingUrl() {
    try {
      await navigator.clipboard.writeText(programmingUrl);
      setStatus("Programming URL copied. Write it as an NDEF URL record, test it, then lock the sticker read-only.");
    } catch {
      setStatus("Copy failed. Select the programming URL manually.");
    }
  }

  async function removeAccess(affiliation: DancerAffiliation) {
    const dancerName = affiliation.dancer?.stageName || "this dancer";
    if (!window.confirm(`Remove ${dancerName} from this venue's NFC-authorized roster? They must tap the dressing-room sticker again before checking in.`)) return;
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

  const activeAffiliations = affiliations.filter((item) => item.status === "active");

  return (
    <article className="info-panel venue-nfc-panel" id="venue-nfc-tags">
      <div>
        <span className="eyebrow">Physical venue access</span>
        <h2>NFC stickers</h2>
        <p>The dressing-room tap automatically authorizes the dancer profile and venue affiliation. Staff never scan or approve a dancer. Cashier tags redeem Club Deals and record attribution.</p>
      </div>
      <div className="venue-nfc-flow" aria-label="NFC workflow">
        <section><b>1</b><span><strong>Dressing room</strong><small>Dancer taps → profile and venue access are approved → a current posted shift checks in.</small></span></section>
        <section><b>2</b><span><strong>Cashier</strong><small>Customer opens a selected Club Deal → taps the cashier sticker → redemption and attribution are recorded.</small></span></section>
      </div>
      <form onSubmit={createTag}>
        <label>Placement
          <select value={type} onChange={(event) => {
            const next = event.target.value as NfcTag["type"];
            setType(next);
            setLabel(next === "dressing_room" ? "Dressing room" : "Main cashier");
          }}>
            <option value="dressing_room">Dressing room — automatic dancer approval</option>
            <option value="cashier">Cashier — Club Deal redemption</option>
          </select>
        </label>
        <label>Sticker label
          <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving}>{isSaving ? "Working…" : "Create programming URL"}</button>
      </form>
      {programmingUrl ? (
        <section className="nfc-programming" aria-label="One-time NFC programming URL">
          <strong>Shown once — program this sticker now</strong>
          <code>{programmingUrl}</code>
          <button type="button" onClick={copyProgrammingUrl}>Copy URL</button>
          <small>Write one NDEF URL record. Test it on iPhone and Android, then permanently lock the physical sticker. Rotating revokes this URL.</small>
        </section>
      ) : null}
      <div className="nfc-tag-list">
        {tags.map((tag) => (
          <section key={tag.id} className={`nfc-tag-row ${tag.status}`}>
            <div>
              <span>{tag.type === "dressing_room" ? "Dressing room" : "Cashier"}</span>
              <strong>{tag.label}</strong>
              <small>{tag.tapCount} confirmed {tag.tapCount === 1 ? "tap" : "taps"}{tag.lastTappedAt ? ` · Last ${formatDate(tag.lastTappedAt)}` : ""}</small>
            </div>
            <b>{tag.status}</b>
            {tag.status !== "revoked" ? (
              <div>
                <button type="button" disabled={isSaving} onClick={() => updateTag(tag.id, tag.status === "active" ? "disable" : "enable")}>
                  {tag.status === "active" ? "Disable" : "Enable"}
                </button>
                <button type="button" disabled={isSaving} onClick={() => updateTag(tag.id, "rotate")}>Rotate</button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
      <section className="venue-nfc-roster" aria-label="NFC-authorized dancer roster">
        <div className="venue-nfc-roster-head">
          <span><strong>NFC-authorized roster</strong><small>Created only by dressing-room taps</small></span>
          <b>{activeAffiliations.length} active</b>
        </div>
        {activeAffiliations.length ? activeAffiliations.map((affiliation) => (
          <div className="venue-nfc-dancer" key={affiliation.id}>
            <span><strong>{affiliation.dancer?.stageName || "Dancer"}</strong><small>Approved by NFC{affiliation.approvedAt ? ` · ${formatDate(affiliation.approvedAt)}` : ""}</small></span>
            <button type="button" disabled={isSaving} onClick={() => removeAccess(affiliation)}>Remove access</button>
          </div>
        )) : <p>No dancers have tapped this venue&apos;s dressing-room sticker yet.</p>}
      </section>
      {status ? <p role="status">{status}</p> : null}
      <style>{`
        .venue-nfc-panel{display:grid;gap:16px}.venue-nfc-panel h2,.venue-nfc-panel p{margin:4px 0}.venue-nfc-panel>div>p{color:#b9accd;line-height:1.45}.venue-nfc-flow{display:grid;grid-template-columns:1fr 1fr;gap:9px}.venue-nfc-flow section{display:flex;gap:10px;padding:12px;border:1px solid rgba(114,80,255,.2);border-radius:12px;background:rgba(92,48,190,.07)}.venue-nfc-flow section>b{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;color:#fff;background:#642bd7}.venue-nfc-flow span,.venue-nfc-roster-head span,.venue-nfc-dancer span{display:grid;gap:3px}.venue-nfc-flow small,.venue-nfc-roster small{color:#9e94aa;line-height:1.35}.venue-nfc-panel form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.venue-nfc-panel label{display:grid;gap:6px;color:#cfc5de;font-size:12px;font-weight:900}.venue-nfc-panel input,.venue-nfc-panel select{min-height:46px;min-width:0;padding:0 11px;border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#fff;background:#16131d;font:inherit}.venue-nfc-panel button{min-height:44px;padding:0 14px;border:1px solid rgba(146,102,255,.48);border-radius:10px;color:#fff;background:rgba(96,43,220,.32);font:inherit;font-weight:900;cursor:pointer}.venue-nfc-panel button:disabled{opacity:.6;cursor:wait}.nfc-programming{display:grid;gap:9px;padding:15px;border:1px solid rgba(69,255,165,.36);border-radius:12px;background:rgba(38,208,119,.07)}.nfc-programming code{overflow-wrap:anywhere;padding:10px;border-radius:8px;color:#c7ffe3;background:#070a08}.nfc-programming small{color:#9db5a8;line-height:1.4}.nfc-tag-list{display:grid;gap:8px}.nfc-tag-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}.nfc-tag-row>div:first-child{display:grid;gap:2px}.nfc-tag-row span{color:#9d82ff;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.nfc-tag-row small{color:#938a9f}.nfc-tag-row b{color:#7dffbd;font-size:10px;text-transform:uppercase}.nfc-tag-row.disabled b,.nfc-tag-row.revoked b{color:#b4aabf}.nfc-tag-row>div:last-child{display:flex;gap:7px}.venue-nfc-roster{display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}.venue-nfc-roster-head,.venue-nfc-dancer{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-nfc-roster-head>b{padding:6px 9px;border-radius:999px;color:#63ffb6;background:rgba(52,211,137,.1);font-size:10px}.venue-nfc-dancer{padding:11px 12px;border:1px solid rgba(69,255,165,.16);border-radius:11px;background:rgba(34,201,129,.05)}.venue-nfc-dancer button{min-height:38px}.venue-nfc-roster>p{color:#978da3}@media(max-width:760px){.venue-nfc-panel form,.nfc-tag-row,.venue-nfc-flow{grid-template-columns:1fr}.nfc-tag-row>div:last-child{display:grid;grid-template-columns:1fr 1fr}.venue-nfc-dancer{align-items:flex-start;flex-direction:column}}
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
