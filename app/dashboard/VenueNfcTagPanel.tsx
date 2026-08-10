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
  const [status, setStatus] = useState("Loading assigned NFC stickers…");
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
      if (!tagResponse.ok || !tagData.ok) throw new Error(tagData.error || "Unable to load assigned NFC stickers.");
      if (!rosterResponse.ok || !rosterData.ok) throw new Error(rosterData.error || "Unable to load the NFC-authorized roster.");
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
        <span className="eyebrow">MyDancr supplied hardware</span>
        <h2>Assigned NFC stickers</h2>
        <p>MyDancr programs and supplies every sticker. This venue only installs the labeled stickers and monitors status and activity here—staff never create tags, scan dancers, or approve profiles.</p>
      </div>
      <div className="venue-nfc-flow" aria-label="NFC workflow">
        <section><b>1</b><span><strong>Dressing room</strong><small>Dancer taps → profile and venue access are approved → a current posted shift checks in.</small></span></section>
        <section><b>2</b><span><strong>Cashier</strong><small>Customer opens a selected Club Deal → taps the cashier sticker → redemption and attribution are recorded.</small></span></section>
      </div>
      <section className="nfc-supply-note" aria-label="NFC sticker support">
        <strong>Installation only</strong>
        <span>Match each supplied sticker to its placement label. If one is lost, damaged, or needs to move, contact MyDancr for a programmed replacement.</span>
      </section>
      <div className="nfc-tag-list" aria-label="Assigned NFC sticker inventory">
        {tags.map((tag) => (
          <section key={tag.id} className={`nfc-tag-row ${tag.status}`}>
            <div>
              <span>{tag.type === "dressing_room" ? "Dressing room" : "Cashier"}</span>
              <strong>{tag.label}</strong>
              <small>{tag.tapCount} confirmed {tag.tapCount === 1 ? "tap" : "taps"}{tag.lastTappedAt ? ` · Last ${formatDate(tag.lastTappedAt)}` : " · Not tapped yet"}</small>
            </div>
            <b>{tag.status}</b>
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
        .venue-nfc-panel{display:grid;gap:16px}.venue-nfc-panel h2,.venue-nfc-panel p{margin:4px 0}.venue-nfc-panel>div>p{color:#b9accd;line-height:1.45}.venue-nfc-flow{display:grid;grid-template-columns:1fr 1fr;gap:9px}.venue-nfc-flow section{display:flex;gap:10px;padding:12px;border:1px solid rgba(114,80,255,.2);border-radius:12px;background:rgba(92,48,190,.07)}.venue-nfc-flow section>b{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;color:#fff;background:#642bd7}.venue-nfc-flow span,.venue-nfc-roster-head span,.venue-nfc-dancer span{display:grid;gap:3px}.venue-nfc-flow small,.venue-nfc-roster small{color:#9e94aa;line-height:1.35}.venue-nfc-panel button{min-height:44px;padding:0 14px;border:1px solid rgba(146,102,255,.48);border-radius:10px;color:#fff;background:rgba(96,43,220,.32);font:inherit;font-weight:900;cursor:pointer}.venue-nfc-panel button:disabled{opacity:.6;cursor:wait}.nfc-supply-note{display:grid;gap:5px;padding:13px 14px;border:1px solid rgba(148,229,255,.24);border-radius:12px;background:rgba(148,229,255,.06)}.nfc-supply-note strong{color:#bff7ff}.nfc-supply-note span{color:#a9a0b6;line-height:1.4}.nfc-tag-list{display:grid;gap:8px}.nfc-tag-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}.nfc-tag-row>div{display:grid;gap:2px}.nfc-tag-row span{color:#9d82ff;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.nfc-tag-row small{color:#938a9f}.nfc-tag-row b{color:#7dffbd;font-size:10px;text-transform:uppercase}.nfc-tag-row.disabled b,.nfc-tag-row.revoked b{color:#b4aabf}.venue-nfc-roster{display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}.venue-nfc-roster-head,.venue-nfc-dancer{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-nfc-roster-head>b{padding:6px 9px;border-radius:999px;color:#63ffb6;background:rgba(52,211,137,.1);font-size:10px}.venue-nfc-dancer{padding:11px 12px;border:1px solid rgba(69,255,165,.16);border-radius:11px;background:rgba(34,201,129,.05)}.venue-nfc-dancer button{min-height:38px}.venue-nfc-roster>p{color:#978da3}@media(max-width:760px){.nfc-tag-row,.venue-nfc-flow{grid-template-columns:1fr}.venue-nfc-dancer{align-items:flex-start;flex-direction:column}}
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
