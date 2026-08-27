"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readDashboardAccessToken,
  requestVenueDancerVerificationsJson,
  requestVenueNfcSupportJson,
  requestVenueNfcTagsJson,
} from "./dashboard-session";

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
  dancer?: {
    stageName?: string;
    slug?: string;
    city?: string;
    avatarUrl?: string | null;
    avatarSrcSet?: string | null;
  } | null;
};

type VenueNfcLoadOptions = {
  silent?: boolean;
};

async function settleVenueNfcRequest<T>(request: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await request() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

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
  const [status, setStatus] = useState("Loading assigned phone-tap stickers…");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingTagId, setTestingTagId] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const testBaselineRef = useRef(0);
  const [supportTagId, setSupportTagId] = useState("");
  const [supportType, setSupportType] = useState<"damaged" | "lost" | "relocate" | "replacement">("damaged");
  const [supportNotes, setSupportNotes] = useState("");
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback(({ silent = false }: VenueNfcLoadOptions = {}) => {
    if (!readDashboardAccessToken("venue")) {
      setIsLoading(false);
      if (!silent) setStatus("Sign in required.");
      return Promise.resolve();
    }
    if (loadInFlightRef.current) return loadInFlightRef.current;
    if (!silent) setIsLoading(true);

    const request = (async () => {
      const tagResult = await settleVenueNfcRequest(() => requestVenueNfcTagsJson({
        cache: "no-store",
        fallbackMessage: "Unable to load assigned stickers.",
      }));
      const rosterResult = await settleVenueNfcRequest(() => requestVenueDancerVerificationsJson("", {
        cache: "no-store",
        fallbackMessage: "Unable to load the verified dancer roster.",
      }));

      if (tagResult.status === "fulfilled") setTags(tagResult.value.tags || []);
      if (rosterResult.status === "fulfilled") setAffiliations(rosterResult.value.affiliations || []);
      if (silent) return;

      if (tagResult.status === "rejected") {
        setStatus(tagResult.reason instanceof Error ? tagResult.reason.message : "Unable to load assigned stickers.");
        return;
      }
      if (rosterResult.status === "rejected") {
        setStatus(rosterResult.reason instanceof Error ? rosterResult.reason.message : "Unable to load the verified dancer roster.");
        return;
      }
      setStatus(tagResult.value.tags?.length
        ? ""
        : "No stickers are assigned yet. MyDancr will program and supply this venue's dancer check-in and guest redemption stickers.");
    })().finally(() => {
      loadInFlightRef.current = null;
      if (!silent) setIsLoading(false);
    });

    loadInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load({ silent: true }); };
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
      if (!readDashboardAccessToken("venue")) return;
      try {
        const data = await requestVenueNfcTagsJson({
          cache: "no-store",
          fallbackMessage: "Unable to check sticker activity.",
        });
        const nextTags = (data.tags || []) as NfcTag[];
        if (!cancelled) setTags(nextTags);
        const tested = nextTags.find((tag) => tag.id === testingTagId);
        if (tested && tested.scanCount > testBaselineRef.current) {
          if (!cancelled) {
            setTestingTagId("");
            setTestStatus(`Test confirmed. ${tested.label} recorded the phone tap.`);
          }
          return;
        }
        if (Date.now() - startedAt >= 60_000 && !cancelled) {
          setTestingTagId("");
          setTestStatus("No phone tap was detected within 60 seconds. Unlock the phone, make sure contactless reading is enabled, and try again—or request support.");
        }
      } catch (error) {
        if (!cancelled) {
          setTestingTagId("");
          setTestStatus(error instanceof Error ? error.message : "Unable to check sticker activity.");
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
    if (!window.confirm(`Remove ${dancerName} from this venue's approved dancer roster? They must use the dancer check-in sticker again before they can check in here.`)) return;
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    setIsSaving(true);
    try {
      await requestVenueDancerVerificationsJson("", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affiliationId: affiliation.id, reason: "Venue removed dancer check-in access." }),
        fallbackMessage: "Unable to remove check-in access.",
      });
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(`${dancerName} was removed. Using the dancer check-in sticker again restores access.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove check-in access.");
    } finally {
      setIsSaving(false);
    }
  }

  function startTapTest(tag: NfcTag) {
    testBaselineRef.current = tag.scanCount;
    setTestStatus(`Ready to test ${tag.label}. Hold an unlocked phone near the physical sticker within 60 seconds.`);
    setTestingTagId(tag.id);
  }

  async function sendSupportRequest() {
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    if (!supportTagId) return setStatus("Choose an assigned sticker.");
    setIsSaving(true);
    try {
      const data = await requestVenueNfcSupportJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: supportTagId, requestType: supportType, notes: supportNotes }),
      });
      setStatus(data.message || "Sticker support request sent.");
      setSupportTagId("");
      setSupportNotes("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request sticker support.");
    } finally {
      setIsSaving(false);
    }
  }

  const activeAffiliations = affiliations.filter((item) => item.status === "active");

  return (
    <article className="info-panel venue-nfc-panel" id="venue-nfc-tags">
      <div>
        <span className="eyebrow">MyDancr supplied hardware</span>
        <h2>Check-in & redemption stickers</h2>
        <p>MyDancr supplies these tap-to-use stickers. Install each sticker where its label says. The dancer check-in sticker approves venue access—no separate manager approval is needed.</p>
      </div>
      <div className="venue-nfc-flow" aria-label="Phone-tap sticker workflow">
        <section><b>1</b><span><strong>Dancer check-in</strong><small>Dancer holds a phone near the check-in sticker → venue access is verified → Working Now starts for six hours. Another tap cannot extend it, and a six-hour cooldown follows.</small></span></section>
        <section><b>2</b><span><strong>Guest redemption</strong><small>Guest chooses a Club Deal → holds a phone near the redemption sticker at checkout → redemption and attribution are recorded.</small></span></section>
      </div>
      <section className="nfc-supply-note" aria-label="Sticker support">
        <strong>Installation only</strong>
        <span>Match each supplied sticker to its placement label. Test a physical tap here, or send MyDancr a tracked replacement request if a sticker is lost, damaged, or moved.</span>
      </section>
      <div className="nfc-tag-list" aria-label="Assigned sticker inventory">
        {tags.map((tag) => (
          <section key={tag.id} className={`nfc-tag-row ${tag.status}`}>
            <div>
              <span>{tag.type === "dressing_room" ? "Dancer check-in" : "Guest redemption"}</span>
              <strong>{tag.label}</strong>
              <small>{tag.scanCount} phone {tag.scanCount === 1 ? "read" : "reads"} · {tag.tapCount} completed {tag.tapCount === 1 ? "action" : "actions"}{tag.lastScannedAt ? ` · Last used ${formatDate(tag.lastScannedAt)}` : " · Not used yet"}</small>
            </div>
            <div className="nfc-tag-actions">
              <b>{tag.status}</b>
              {tag.status === "active" ? <button type="button" disabled={Boolean(testingTagId)} onClick={() => startTapTest(tag)}>{testingTagId === tag.id ? "Listening…" : "Test sticker"}</button> : null}
              {canRequestSupport ? <button type="button" onClick={() => setSupportTagId(tag.id)}>Get support</button> : null}
            </div>
          </section>
        ))}
      </div>
      {testStatus ? <p className="nfc-test-status" role="status">{testStatus}</p> : null}
      {supportTagId ? (
        <section className="nfc-support-form" aria-label="Sticker support request">
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
          <span><strong>Approved dancer roster</strong><small>Authorized by the dancer check-in sticker</small></span>
          <b>{isLoading && !activeAffiliations.length ? "…" : `${activeAffiliations.length} active`}</b>
        </div>
        {activeAffiliations.length ? activeAffiliations.map((affiliation) => (
          <div className="venue-nfc-dancer" key={affiliation.id}>
            <span className="venue-nfc-dancer-identity">
              <span className="venue-nfc-dancer-avatar" data-dancer-avatar="" aria-hidden="true">
                <span data-dancer-avatar-border="">
                  {affiliation.dancer?.avatarUrl ? (
                    <img
                      src={affiliation.dancer.avatarUrl}
                      srcSet={affiliation.dancer.avatarSrcSet || undefined}
                      sizes="48px"
                      alt=""
                    />
                  ) : (
                    (affiliation.dancer?.stageName || "D").slice(0, 1).toUpperCase()
                  )}
                </span>
              </span>
              <span className="venue-nfc-dancer-copy">
                <strong>{affiliation.dancer?.stageName || "Dancer"}</strong>
                <small>Check-in verified{affiliation.approvedAt ? ` · ${formatDate(affiliation.approvedAt)}` : ""}</small>
              </span>
            </span>
            {canManageRoster ? (
              <button
                className="venue-nfc-remove-access"
                type="button"
                disabled={isSaving}
                aria-label={`Remove ${affiliation.dancer?.stageName || "dancer"} access`}
                onClick={() => removeAccess(affiliation)}
              >
                Remove access
              </button>
            ) : null}
          </div>
        )) : !isLoading ? <p>No dancers have used this venue&apos;s dancer check-in sticker yet.</p> : null}
      </section>
      {status ? <p role="status">{status}</p> : null}
      <style>{`
        .venue-nfc-panel{display:grid;gap:16px}.venue-nfc-panel h2,.venue-nfc-panel p{margin:4px 0}.venue-nfc-panel>div>p{color:#b9accd;line-height:1.45}.venue-nfc-flow{display:grid;grid-template-columns:1fr 1fr;gap:9px}.venue-nfc-flow section{display:flex;gap:10px;padding:12px;border:1px solid rgba(114,80,255,.2);border-radius:12px;background:rgba(92,48,190,.07)}.venue-nfc-flow section>b{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;color:#fff;background:#642bd7}.venue-nfc-flow span,.venue-nfc-roster-head span{display:grid;gap:3px}.venue-nfc-flow small,.venue-nfc-roster small{color:#9e94aa;line-height:1.35}.venue-nfc-panel button{min-height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#f8fafc;background:rgba(255,255,255,.055);font:inherit;font-weight:850;cursor:pointer}.venue-nfc-panel button:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}.venue-nfc-panel button:disabled{opacity:.6;cursor:wait}.nfc-supply-note{display:grid;gap:5px;padding:13px 14px;border:1px solid rgba(34,211,238,.24);border-radius:12px;background:rgba(34,211,238,.05)}.nfc-supply-note strong{color:#a5f3fc}.nfc-supply-note span{color:#a9a0b6;line-height:1.4}.nfc-tag-list{display:grid;gap:8px}.nfc-tag-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}.nfc-tag-row>div{display:grid;gap:2px}.nfc-tag-row span{color:#c4b5fd;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.nfc-tag-row small{color:#938a9f}.nfc-tag-row b{color:#6ee7b7;font-size:10px;text-transform:uppercase}.nfc-tag-row.disabled b,.nfc-tag-row.revoked b{color:#b4aabf}.nfc-tag-actions{display:flex!important;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.nfc-tag-actions button{min-height:34px;font-size:11px}.nfc-test-status{padding:12px 14px;border:1px solid rgba(16,185,129,.3);border-radius:11px;color:#a7f3d0;background:rgba(16,185,129,.06)}.nfc-support-form{display:grid;gap:12px;padding:14px;border:1px solid #334155;border-radius:12px;background:#0b0b10}.nfc-support-form label{display:grid;gap:6px;color:#cbd5e1;font-size:12px;font-weight:850}.nfc-support-form select,.nfc-support-form textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#111118;font:inherit}.nfc-support-form>div{display:flex;gap:8px;flex-wrap:wrap}.venue-nfc-roster{display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}.venue-nfc-roster-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-nfc-roster-head>b{padding:6px 9px;border-radius:999px;color:#6ee7b7;background:rgba(16,185,129,.1);font-size:10px}.venue-nfc-dancer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 11px;border:1px solid rgba(16,185,129,.16);border-radius:11px;background:rgba(16,185,129,.04)}.venue-nfc-dancer-identity{min-width:0;display:flex!important;align-items:center;gap:10px}.venue-nfc-dancer-avatar{width:48px;height:48px;display:grid!important;place-items:center;flex:0 0 48px;overflow:hidden;border-radius:50%;color:#f8fafc;background:#111118;font-weight:900}.venue-nfc-dancer-copy{min-width:0;display:grid!important;gap:3px}.venue-nfc-dancer-copy strong{overflow:hidden;color:#f8fafc;text-overflow:ellipsis;white-space:nowrap}.venue-nfc-remove-access{min-height:34px!important;padding:0 10px!important;border-color:rgba(251,113,133,.24)!important;color:#fda4af!important;background:rgba(159,18,57,.08)!important;font-size:11px!important;white-space:nowrap}.venue-nfc-remove-access:hover{border-color:rgba(251,113,133,.4)!important;background:rgba(159,18,57,.14)!important}.venue-nfc-roster>p{color:#978da3}@media(max-width:760px){.nfc-tag-row,.venue-nfc-flow{grid-template-columns:1fr}.nfc-tag-actions{justify-content:flex-start}}@media(max-width:390px){.venue-nfc-dancer{gap:8px;padding:9px}.venue-nfc-dancer-avatar{width:44px;height:44px;flex-basis:44px}.venue-nfc-remove-access{padding:0 8px!important;font-size:10px!important}}
      `}</style>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
