"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClubDeal } from "@/src/lib/dancr/types";
import NfcIcon from "@/app/components/NfcIcon";

const SESSION_KEY = "dancrAuthSessionV1";
const TAP_SESSION_KEY = "mydancrNfcTapSessionV1";
const DEAL_INTENT_KEY = "mydancrPendingNfcDealV1";

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
};

export function NfcTapClient({ token }: { token: string }) {
  const [state, setState] = useState<TagState | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Reading club tag…");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [auth, setAuth] = useState({ role: "", accessToken: "", refreshToken: "" });
  const pendingIntent = useMemo(() => readPendingDealIntent(), []);

  useEffect(() => setAuth(readAuthSession()), []);

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
        setStatus(data.tag.type === "dressing_room"
          ? "Create a dancer account or sign in to attach this club tap."
          : data.deals?.length
            ? "Choose the offer being used at this register."
            : "This club has no active Club Deals right now.");
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "This NFC tag is unavailable.");
          setStatus("");
        }
      });
    return () => { cancelled = true; };
  }, [pendingIntent?.dealId, token]);

  const submitTap = useCallback(async () => {
    if (!state || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setStatus("Verifying this tap with MyDancr…");
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
      setComplete(true);
      setStatus(data.message || "NFC tap confirmed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete this NFC tap.");
      setStatus("");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, pendingIntent, selectedDealId, state, token]);

  const activeDeal = state?.deals.find((deal) => deal.id === selectedDealId) || state?.deals[0] || null;
  const dancerNeedsSignIn = state?.tag.type === "dressing_room" && (auth.role !== "dancer" || !auth.accessToken);

  return (
    <main className="nfc-page">
      <section className={`nfc-card${complete ? " complete" : ""}`}>
        <div className="nfc-symbol"><NfcIcon /></div>
        <span className="eyebrow">Verified club NFC</span>
        <h1>{state?.venue.name || "MyDancr NFC"}</h1>
        {state ? <p>{state.venue.city}, {state.venue.state} · {state.tag.label}</p> : null}

        {state?.tag.type === "dressing_room" && !complete ? (
          <div className="nfc-action-copy">
            <strong>Dancer club activation</strong>
            <p>New here? This tap carries the club&apos;s authorization into dancer account creation. Already have a reviewed profile? Sign in and the same tap adds this club immediately.</p>
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
                <p>{activeDeal.dealDescription}</p>
                {activeDeal.dealTerms ? <small>{activeDeal.dealTerms}</small> : null}
              </article>
            ) : null}
          </div>
        ) : null}

        {status ? <p className="nfc-status" role="status">{status}</p> : null}
        {error ? <p className="nfc-error" role="alert">{error}</p> : null}

        {!complete && state ? (
          dancerNeedsSignIn ? (
            <>
              <Link className="nfc-primary" href={`/account?role=dancer&mode=login&return_to=${encodeURIComponent(`/nfc/${token}`)}`}>
                Sign in to use venue NFC
              </Link>
              <Link className="nfc-secondary" href="/account?role=dancer&mode=signup">
                Create dancer account
              </Link>
            </>
          ) : state.tag.type === "cashier" && !activeDeal ? null : (
            <button className="nfc-primary" type="button" onClick={submitTap} disabled={isSubmitting}>
              {isSubmitting
                ? "Confirming…"
                : state.tag.type === "dressing_room"
                  ? "Confirm club tap"
                  : "Redeem this Club Deal"}
            </button>
          )
        ) : null}
        {complete ? <Link className="nfc-secondary" href={state?.tag.type === "dressing_room" ? "/dashboard" : "/"}>Done</Link> : null}
      </section>
      <p className="nfc-security">Only use MyDancr NFC stickers physically posted by club staff. A disabled or replaced sticker cannot authorize an action.</p>
      <style>{`
        .nfc-page{min-height:100dvh;display:grid;place-content:center;gap:18px;padding:28px 16px 120px;color:#fff;background:radial-gradient(circle at 50% 18%,rgba(112,42,255,.22),transparent 32%),#050507;font-family:var(--font-body,Arial,sans-serif)}
        .nfc-card{width:min(460px,calc(100vw - 32px));display:grid;justify-items:center;gap:14px;padding:30px 22px;border:1px solid rgba(150,112,255,.38);border-radius:28px;background:rgba(12,10,18,.94);box-shadow:0 28px 90px rgba(0,0,0,.62)}
        .nfc-card.complete{border-color:rgba(70,255,165,.5)}.nfc-symbol{width:84px;height:84px;display:grid;place-items:center;border-radius:50%;color:#fff;background:linear-gradient(145deg,#4a13c8,#8e36ff);box-shadow:0 0 34px rgba(125,60,255,.58);font-weight:950;transform:rotate(-18deg)}
        .nfc-symbol svg{width:52px;height:52px}.nfc-card .eyebrow{color:#9a7aff;font-size:11px;font-weight:950;letter-spacing:.17em;text-transform:uppercase}.nfc-card h1,.nfc-card h2,.nfc-card p{margin:0}.nfc-card>h1{font-size:clamp(30px,8vw,44px);text-align:center}.nfc-card>p{color:#aaa2b8;text-align:center}.nfc-action-copy,.nfc-deals{width:100%;display:grid;gap:10px;padding:17px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(255,255,255,.035);box-sizing:border-box}.nfc-action-copy strong,.nfc-deals>strong{font-size:17px}.nfc-action-copy p,.nfc-deals p,.nfc-deals small{color:#b9b0c8;line-height:1.45}.nfc-deals label{display:grid;gap:6px;color:#c8bdd9;font-size:12px;font-weight:850}.nfc-deals select{min-height:48px;padding:0 12px;border:1px solid rgba(255,255,255,.16);border-radius:12px;color:#fff;background:#17131f;font:inherit}.nfc-deals article{display:grid;gap:6px}.nfc-deals article>span{color:#72f0b2;font-size:10px;font-weight:950;letter-spacing:.13em;text-transform:uppercase}.nfc-deals h2{font-size:22px}.nfc-status{color:#8fffc7!important}.nfc-error{color:#ff9eaf!important}.nfc-primary,.nfc-secondary{width:100%;min-height:54px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(167,118,255,.65);border-radius:16px;color:#fff;background:linear-gradient(135deg,#3910a9,#7119ef);font:inherit;font-weight:950;text-decoration:none;cursor:pointer}.nfc-primary:disabled{opacity:.7;cursor:wait}.nfc-secondary{background:rgba(255,255,255,.07)}.nfc-security{width:min(430px,calc(100vw - 44px));margin:0 auto;color:#716a7d;font-size:11px;line-height:1.45;text-align:center}
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
  if (value === "drink") return "Drink offer";
  if (value === "bottle_service") return "Bottle service";
  if (value === "other") return "Club offer";
  return "Admission offer";
}
