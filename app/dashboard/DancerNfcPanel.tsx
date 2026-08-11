"use client";

import { useState } from "react";
import NfcIcon from "../components/NfcIcon";

const SESSION_KEY = "dancrAuthSessionV1";

type VenueSummary = { id?: string; name?: string; slug?: string; city?: string; state?: string | null };
type Affiliation = {
  id?: string;
  status?: string;
  approvedAt?: string | null;
  venue?: VenueSummary | null;
};
type NfcState = {
  profileAuthorization?: {
    authorized?: boolean;
    authorizedAt?: string | null;
    mediaReviewStatus?: string | null;
    isPublic?: boolean;
  };
  enrollment?: {
    status?: string;
    tappedAt?: string;
    expiresAt?: string;
    venue?: VenueSummary | null;
  } | null;
};

export default function DancerNfcPanel({
  initialAffiliations = [],
  initialNfcState,
}: {
  initialAffiliations?: Array<Record<string, unknown>>;
  initialNfcState?: Record<string, unknown> | null;
}) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>(initialAffiliations as Affiliation[]);
  const [nfcState, setNfcState] = useState<NfcState>((initialNfcState || {}) as NfcState);
  const [status, setStatus] = useState("");
  const [pendingId, setPendingId] = useState("");
  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const enrollment = nfcState.enrollment;
  const authorized = nfcState.profileAuthorization?.authorized === true || activeAffiliations.length > 0;
  const isPublic = nfcState.profileAuthorization?.isPublic === true;
  const pendingEnrollment = enrollment?.status === "pending";

  async function refresh() {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setPendingId("refresh");
    setStatus("");
    try {
      const response = await fetch("/api/dancer/venue-verification", { headers: auth, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to refresh NFC access.");
      setAffiliations(data.affiliations || []);
      setNfcState({ profileAuthorization: data.profileAuthorization, enrollment: data.enrollment });
      setStatus("Dressing-room NFC access is current.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refresh NFC access.");
    } finally {
      setPendingId("");
    }
  }

  async function removeAffiliation(affiliation: Affiliation) {
    if (!affiliation.id) return;
    const venueName = affiliation.venue?.name || "this venue";
    if (!window.confirm(`Remove ${venueName} from your NFC-authorized venues? You must tap its dressing-room sticker again before working there.`)) return;
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setPendingId(affiliation.id);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/venue-verification", {
        method: "DELETE",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ affiliationId: affiliation.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove venue access.");
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(data.message || "Venue NFC access removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove venue access.");
    } finally {
      setPendingId("");
    }
  }

  return (
    <article className={`info-panel dancer-nfc-panel ${authorized ? "is-authorized" : ""}`} id="dancer-venue-verification">
      <div className="dancer-nfc-icon"><NfcIcon /></div>
      <div className="dancer-nfc-content">
        <span className="eyebrow">Dressing-room NFC</span>
        <div className="dancer-nfc-heading">
          <h2>{authorized ? "Profile and venue approved" : pendingEnrollment ? "Tap saved" : "Tap to approve your profile"}</h2>
          <b>{authorized ? "APPROVED" : pendingEnrollment ? "FINISH SETUP" : "TAP REQUIRED"}</b>
        </div>
        {authorized ? (
          <p>Your first eligible dressing-room tap approved your profile and venue access. No manager QR or separate venue approval is required.</p>
        ) : pendingEnrollment ? (
          <p>Your tap at {enrollment?.venue?.name || "the club"} is saved. Complete profile setup and media review; MyDancr will activate the venue automatically when the profile is ready.</p>
        ) : (
          <p>At the club, unlock your signed-in phone and tap its official MyDancr dressing-room sticker. The first eligible tap approves your profile, connects that venue, and checks in a current posted shift.</p>
        )}

        {activeAffiliations.length ? (
          <div className="dancer-nfc-roster" aria-label="NFC-authorized venues">
            {activeAffiliations.map((affiliation) => (
              <section key={affiliation.id || affiliation.venue?.id}>
                <span>
                  <strong>{affiliation.venue?.name || "Venue"}</strong>
                  <small>NFC-authorized{affiliation.approvedAt ? ` · ${formatDate(affiliation.approvedAt)}` : ""}</small>
                </span>
                <button type="button" disabled={Boolean(pendingId)} onClick={() => removeAffiliation(affiliation)}>Remove</button>
              </section>
            ))}
          </div>
        ) : null}

        <div className="dancer-nfc-notes">
          <span>A current posted shift becomes Working Now for up to five hours after the tap.</span>
          <span>Tap the same dressing-room sticker again to renew an active shift&apos;s NFC check-in.</span>
          <span>Media safety review remains separate{isPublic ? "; your profile is live." : " and must finish before your profile is public."}</span>
        </div>
        <button className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh}>
          {pendingId === "refresh" ? "Refreshing…" : "Refresh NFC status"}
        </button>
        {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
        <small>Only an active MyDancr-supplied dressing-room sticker can authorize this action.</small>
      </div>
      <style>{DANCER_NFC_STYLE}</style>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const DANCER_NFC_STYLE = [
  ".dancer-nfc-panel{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:start;border-color:rgba(126,87,255,.34);background:radial-gradient(circle at 0 0,rgba(116,60,255,.14),transparent 22rem),rgba(12,12,18,.88)}",
  ".dancer-nfc-panel.is-authorized{border-color:rgba(73,255,170,.34);background:radial-gradient(circle at 0 0,rgba(25,190,116,.14),transparent 22rem),rgba(9,15,14,.9)}",
  ".dancer-nfc-icon{width:64px;height:64px;display:grid;place-items:center;border-radius:50%;color:#fff;background:linear-gradient(145deg,#4314b8,#842cff);box-shadow:0 0 28px rgba(125,59,255,.42)}",
  ".is-authorized .dancer-nfc-icon{background:linear-gradient(145deg,#087a52,#22cb83);box-shadow:0 0 28px rgba(41,223,145,.3)}",
  ".dancer-nfc-icon svg{width:38px;height:38px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
  ".dancer-nfc-content{min-width:0}.dancer-nfc-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.dancer-nfc-heading h2,.dancer-nfc-panel p{margin:4px 0}",
  ".dancer-nfc-heading b{padding:6px 9px;border:1px solid rgba(142,102,255,.36);border-radius:999px;color:#c8b9ff;font-size:9px;letter-spacing:.1em;white-space:nowrap}.is-authorized .dancer-nfc-heading b{border-color:rgba(69,255,165,.36);color:#70ffc1}",
  ".dancer-nfc-panel p,.dancer-nfc-panel small,.dancer-nfc-notes{color:#b9accd;line-height:1.45}.dancer-nfc-roster{display:grid;gap:7px;margin:14px 0}.dancer-nfc-roster section{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid rgba(69,255,165,.18);border-radius:11px;background:rgba(34,201,129,.06)}",
  ".dancer-nfc-roster span{display:grid;gap:2px}.dancer-nfc-roster small{font-size:11px}.dancer-nfc-roster button,.dancer-nfc-refresh{min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#fff;background:rgba(255,255,255,.06);font:inherit;font-weight:800;cursor:pointer}",
  ".dancer-nfc-notes{display:grid;gap:6px;margin:12px 0;font-size:12px}.dancer-nfc-notes span{padding-left:15px;position:relative}.dancer-nfc-notes span:before{content:'✓';position:absolute;left:0;color:#5fffb5}.dancer-nfc-status{font-size:12px}.dancer-nfc-refresh{margin:0 0 10px}.dancer-nfc-panel small{display:block}",
  "@media(max-width:620px){.dancer-nfc-panel{grid-template-columns:1fr}.dancer-nfc-icon{width:54px;height:54px}.dancer-nfc-icon svg{width:32px;height:32px}.dancer-nfc-heading{align-items:flex-start;flex-direction:column}.dancer-nfc-roster section{align-items:flex-start}}",
].join("");
