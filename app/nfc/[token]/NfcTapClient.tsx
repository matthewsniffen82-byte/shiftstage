"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClubDeal } from "@/src/lib/dancr/types";
import NfcIcon from "@/app/components/NfcIcon";
import { customerFacingDealDescription, customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";

const SESSION_KEY = "dancrAuthSessionV1";
const TAP_SESSION_KEY = "mydancrNfcTapSessionV1";
const DEAL_INTENT_KEY = "mydancrPendingNfcDealV2";

type TagState = {
  tag: { id: string; type: "dressing_room" | "cashier"; label: string };
  venue: { id: string; name: string; slug: string; city: string; state: string };
  deals: ClubDeal[];
};

type PendingDealIntent = {
  venueId: string;
  dealId: string;
  sourceType: "club_page" | "dancer_profile";
  dancerId?: string | null;
  attributionToken?: string | null;
  savedAt: number;
  expiresAt?: number;
};

type TapPhase = "reading" | "ready" | "redeeming" | "redeemed" | "error";

export function NfcTapClient({ token }: { token: string }) {
  const [state, setState] = useState<TagState | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Reading club tag…");
  const [phase, setPhase] = useState<TapPhase>("reading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [dancerActivationComplete, setDancerActivationComplete] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [auth, setAuth] = useState({ role: "", accessToken: "", refreshToken: "" });
  const autoSubmittedRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const pendingIntent = useMemo(() => readPendingDealIntent(), []);

  useEffect(() => setAuth(readAuthSession()), []);

  useEffect(() => () => {
    if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/nfc/${encodeURIComponent(token)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "This NFC tag is unavailable.");
        if (cancelled) return;
        setState(data);
        const preferred = data.deals?.some((deal: ClubDeal) => deal.id === pendingIntent?.dealId)
          ? pendingIntent?.dealId
          : data.deals?.[0]?.id || "";
        setSelectedDealId(preferred || "");
        setPhase("ready");
        const preferredDeal = data.deals?.find((deal: ClubDeal) => deal.id === preferred);
        setStatus(data.tag.type === "dressing_room"
          ? "Sign in as a dancer to start one six-hour Working Now session."
          : pendingIntent?.venueId === data.venue.id && preferredDeal
            ? `${preferredDeal.dealTitle} is selected on this device. Confirm it at this cashier NFC sticker.`
          : data.deals?.length
            ? "Choose the offer being used at this register."
            : "This club has no active Club Deals right now.");
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "This NFC tag is unavailable.");
          setStatus("");
          setPhase("error");
        }
      });
    return () => { cancelled = true; };
  }, [pendingIntent?.dealId, pendingIntent?.venueId, token]);

  const submitTap = useCallback(async () => {
    if (!state || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setStatus("Verifying this tap with MyDancr…");
    setPhase("redeeming");
    try {
      const auth = readAuthSession();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.accessToken) headers.authorization = `Bearer ${auth.accessToken}`;
      if (auth.refreshToken) headers["x-dancr-refresh-token"] = auth.refreshToken;
      const intent = state.tag.type === "cashier" && pendingIntent?.venueId === state.venue.id
        ? pendingIntent
        : null;
      const response = await fetch(`/api/nfc/${encodeURIComponent(token)}`, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          sessionId: readOrCreateTapSessionId(),
          dealId: selectedDealId || null,
          sourceType: intent?.sourceType || "club_page",
          dancerId: intent?.dancerId || null,
          attributionToken: intent?.attributionToken || null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to complete this NFC tap.");
      persistRefreshedSession(data.session);
      if (state.tag.type === "cashier") clearPendingDealIntent();
      let completedDancerTap = state.tag.type === "dressing_room"
        && data.affiliation?.enrollmentStatus === "completed";
      if (state.tag.type === "dressing_room" && !completedDancerTap) {
        const verificationResponse = await fetch("/api/dancer/dashboard", {
          headers,
          cache: "no-store",
          credentials: "same-origin",
        });
        const verification = await verificationResponse.json();
        completedDancerTap = verificationResponse.ok
          && verification.ok === true
          && (
            verification.nfc?.profileAuthorization?.authorized === true
            || verification.nfc?.enrollment?.status === "completed"
            || verification.affiliations?.some((item: { status?: string }) => item.status === "active")
          );
      }
      setDancerActivationComplete(completedDancerTap);
      setComplete(true);
      setPhase("redeemed");
      const successMessage = data.message || (state.tag.type === "cashier" ? "Club Deal redeemed." : "NFC tap confirmed.");
      setStatus(completedDancerTap
        ? `${successMessage} Opening your live dancer dashboard…`
        : state.tag.type === "dressing_room"
          ? "Your physical club tap was saved, but profile activation is not complete yet. Open the dancer dashboard to review the remaining setup requirement."
          : successMessage);
      if (completedDancerTap) {
        redirectTimerRef.current = window.setTimeout(() => {
          window.location.replace("/dashboard/dancer?nfc=complete");
        }, 700);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete this NFC tap.");
      setStatus(state?.tag.type === "dressing_room"
        ? "Profile activation was not completed. Step 3 remains open—stay at this sticker and try the tap again."
        : "The tap was not completed. Check the offer and try again at this sticker.");
      setPhase("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, pendingIntent, selectedDealId, state, token]);

  useEffect(() => {
    if (
      autoSubmittedRef.current
      || !state
      || state.tag.type !== "dressing_room"
      || auth.role !== "dancer"
      || !auth.accessToken
      || complete
    ) return;
    autoSubmittedRef.current = true;
    void submitTap();
  }, [auth.accessToken, auth.role, complete, state, submitTap]);

  const activeDeal = state?.deals.find((deal) => deal.id === selectedDealId) || state?.deals[0] || null;
  const activeDealDescription = customerFacingDealDescription(activeDeal?.dealDescription);
  const activeDealTerms = customerFacingDealTerms(activeDeal?.dealTerms);
  const dancerNeedsSignIn = state?.tag.type === "dressing_room" && (auth.role !== "dancer" || !auth.accessToken);
  const exitHref = auth.role === "dancer" ? "/dashboard/dancer" : "/";
  const exitLabel = auth.role === "dancer" ? "Back to dancer dashboard" : "Back to MyDancr";

  return (
    <main className="nfc-page">
      <section className={`nfc-card${complete ? " complete" : ""}`} data-phase={phase} aria-busy={phase === "reading" || phase === "redeeming"}>
        <a className="nfc-exit" href={exitHref} aria-label={exitLabel} title={exitLabel}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </a>
        <div className="nfc-symbol"><NfcIcon /></div>
        <span className="eyebrow">{state?.tag.type === "cashier" ? "Cashier NFC redemption" : "Verified club NFC"}</span>
        <h1>{state?.venue.name || "MyDancr NFC"}</h1>
        {state ? <p>{state.venue.city}, {state.venue.state} · {state.tag.label}</p> : null}

        {state?.tag.type === "dressing_room" && !complete ? (
          <div className="nfc-action-copy">
            <strong>Dressing-room Working Now</strong>
            <p>Sign in and confirm this physical venue tap. An eligible profile appears in Working Now for six hours, followed by a six-hour cooldown. Retaps do not extend the session, and no phone location is collected.</p>
          </div>
        ) : null}

        {state?.tag.type === "cashier" && !complete ? (
          <div className="nfc-deals">
            <strong>Club Deal at the register</strong>
            {state.deals.length > 1 ? (
              <label>
                Offer
                <select value={selectedDealId} onChange={(event) => setSelectedDealId(event.target.value)}>
                  {state.deals.map((deal) => <option key={deal.id} value={deal.id}>{deal.dealTitle}</option>)}
                </select>
              </label>
            ) : null}
            {activeDeal ? (
              <article>
                <span>{dealTypeLabel(activeDeal.offerType)}</span>
                <h2>{activeDeal.dealTitle}</h2>
                {activeDealDescription ? <p>{activeDealDescription}</p> : null}
                {activeDealTerms ? <small>{activeDealTerms}</small> : null}
              </article>
            ) : null}
          </div>
        ) : null}

        {status ? <p className="nfc-status" role="status" aria-live="polite">{status}</p> : null}
        {error ? <p className="nfc-error" role="alert">{error}</p> : null}

        {!complete && state ? (
          dancerNeedsSignIn ? (
            <>
              <Link className="nfc-primary" href={`/account?role=dancer&mode=login&venue_nfc=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/nfc/${token}`)}`}>
                Sign in to use venue NFC
              </Link>
              <Link className="nfc-secondary" href={`/account?role=dancer&mode=signup&venue_nfc=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/nfc/${token}`)}`}>
                Create dancer account
              </Link>
            </>
          ) : state.tag.type === "cashier" && !activeDeal ? null : (
            <button className="nfc-primary" type="button" onClick={submitTap} disabled={isSubmitting}>
              {isSubmitting
                ? "Confirming…"
                : phase === "error"
                  ? "Try again"
                : state.tag.type === "dressing_room"
                  ? "Confirm Working Now"
                  : "Redeem this Club Deal"}
            </button>
          )
        ) : null}
        {phase === "error" && !complete ? <a className="nfc-secondary" href={exitHref}>{exitLabel}</a> : null}
        {complete ? (
          <a
            className="nfc-secondary"
            href={state?.tag.type === "dressing_room" && dancerActivationComplete ? "/dashboard/dancer?nfc=complete" : state?.tag.type === "dressing_room" ? "/dashboard/dancer" : "/"}
          >
            Done
          </a>
        ) : null}
      </section>
      <p className="nfc-security">Only use MyDancr NFC stickers physically posted by club staff. A disabled or replaced sticker cannot authorize an action.</p>
      <style>{`
        .nfc-page{min-height:100dvh;display:grid;grid-template-columns:minmax(0,1fr);align-content:start;justify-items:center;gap:18px;box-sizing:border-box;padding:max(clamp(28px,6dvh,58px),env(safe-area-inset-top)) 16px max(90px,calc(24px + env(safe-area-inset-bottom)));overflow-anchor:none;color:#fff;background:radial-gradient(circle at 50% 18%,rgba(53,216,255,.08),transparent 30rem),#050507;font-family:var(--font-body,Arial,sans-serif)}
        .nfc-card{position:relative;width:min(430px,calc(100vw - 32px));max-width:100%;display:grid;justify-items:center;align-content:start;gap:13px;box-sizing:border-box;padding:26px 20px;overflow-anchor:none;border:1px solid rgba(255,255,255,.14);border-radius:24px;background:linear-gradient(145deg,rgba(17,18,22,.96),rgba(5,6,8,.985));box-shadow:0 28px 80px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.06)}
        .nfc-exit{position:absolute;z-index:2;top:14px;right:14px;width:48px;height:48px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.14);border-radius:50%;color:rgba(255,255,255,.78);background:rgba(34,35,41,.94);box-shadow:0 10px 28px rgba(0,0,0,.34);text-decoration:none}.nfc-exit svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}.nfc-exit:focus-visible{outline:3px solid rgba(53,216,255,.74);outline-offset:3px}
        .nfc-card.complete{border-color:rgba(126,234,255,.28)}.nfc-symbol{width:88px;height:88px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.14);border-radius:20px;color:#f7f1ff;background:radial-gradient(circle at 45% 35%,rgba(133,76,255,.22),transparent 56%),rgba(9,9,13,.92);box-shadow:0 14px 34px rgba(0,0,0,.38);font-weight:950}
        .nfc-symbol svg{width:60px;height:60px;padding:12px;box-sizing:border-box;border:1px solid rgba(159,117,255,.42);border-radius:50%;background:rgba(11,8,20,.74)}.nfc-card .eyebrow{color:#35d8ff;font-size:11px;font-weight:950;letter-spacing:.17em;text-transform:uppercase}.nfc-card h1,.nfc-card h2,.nfc-card p{margin:0}.nfc-card>h1{font-size:clamp(28px,8vw,40px);text-align:center}.nfc-card>p{color:rgba(248,248,252,.72);text-align:center}.nfc-action-copy,.nfc-deals{width:100%;display:grid;gap:10px;padding:15px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.035);box-sizing:border-box}.nfc-action-copy strong,.nfc-deals>strong{font-size:16px}.nfc-action-copy p,.nfc-deals p,.nfc-deals small{color:rgba(248,248,252,.7);line-height:1.45}.nfc-deals label{display:grid;gap:6px;color:rgba(248,248,252,.72);font-size:12px;font-weight:850}.nfc-deals select{min-height:48px;padding:0 12px;border:1px solid rgba(255,255,255,.16);border-radius:12px;color:#fff;background:#17181d;font:inherit}.nfc-deals article{display:grid;gap:6px}.nfc-deals article>span{color:#8deeff;font-size:10px;font-weight:950;letter-spacing:.13em;text-transform:uppercase}.nfc-deals h2{font-size:22px}.nfc-status{width:100%;padding:10px 12px;box-sizing:border-box;border:1px solid rgba(126,234,255,.2);border-radius:13px;color:#d9f9ff!important;background:rgba(53,216,255,.06);font-size:12px;line-height:1.4}.nfc-card[data-phase="error"] .nfc-status,.nfc-error{border-color:rgba(255,157,174,.28);color:#ffd5dd!important;background:rgba(255,99,132,.07)}.nfc-error{width:100%;padding:10px 12px;box-sizing:border-box;border:1px solid rgba(255,157,174,.28);border-radius:13px;font-size:12px;line-height:1.4}.nfc-primary,.nfc-secondary{width:100%;min-height:52px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.28);border-radius:999px;color:#fff;background:linear-gradient(135deg,rgba(76,35,176,.96),rgba(24,94,126,.96));font:inherit;font-weight:950;text-decoration:none;cursor:pointer}.nfc-primary:disabled{opacity:.7;cursor:wait}.nfc-secondary{border-color:rgba(255,255,255,.13);background:rgba(255,255,255,.045)}.nfc-security{width:min(410px,calc(100vw - 44px));margin:0 auto;color:rgba(248,248,252,.4);font-size:11px;line-height:1.45;text-align:center}
      `}</style>
    </main>
  );
}

function readAuthSession() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return {
      role: typeof value?.account?.role === "string" ? value.account.role : "",
      accessToken: typeof value?.accessToken === "string" ? value.accessToken : "",
      refreshToken: typeof value?.refreshToken === "string" ? value.refreshToken : "",
    };
  } catch {
    return { role: "", accessToken: "", refreshToken: "" };
  }
}

function readOrCreateTapSessionId() {
  try {
    const existing = window.localStorage.getItem(TAP_SESSION_KEY) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(TAP_SESSION_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function readPendingDealIntent(): PendingDealIntent | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEAL_INTENT_KEY) || "null");
    if (!value || typeof value !== "object" || Date.now() - Number(value.savedAt || 0) > 12 * 60 * 60 * 1000) return null;
    if (typeof value.venueId !== "string" || typeof value.dealId !== "string") return null;
    return value as PendingDealIntent;
  } catch {
    return null;
  }
}

function clearPendingDealIntent() {
  try { window.localStorage.removeItem(DEAL_INTENT_KEY); } catch { /* storage is optional */ }
}

function persistRefreshedSession(session: unknown) {
  if (!session || typeof session !== "object") return;
  const value = session as { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown };
  if (typeof value.accessToken !== "string" || !value.accessToken) return;
  try {
    const current = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...current,
      accessToken: value.accessToken,
      refreshToken: typeof value.refreshToken === "string" ? value.refreshToken : current?.refreshToken,
      expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : current?.expiresAt,
    }));
  } catch { /* a future sign-in can restore storage */ }
}

function dealTypeLabel(value: ClubDeal["offerType"]) {
  if (value === "other") return "Club offer";
  return "Admission offer";
}
