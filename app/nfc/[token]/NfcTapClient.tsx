"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicClubDeal } from "@/src/lib/dancr/types";
import NfcIcon from "@/app/components/NfcIcon";
import { VISIBILITY_OPTIONS, type VisibilityMode } from "@/src/lib/dancr/visibility-mode";
import { externalTapRankingMessage } from "@/src/lib/dancr/external-ranking-progress";
import {
  persistRefreshedBrowserAuthSession,
  readBrowserAuthSession,
} from "@/src/lib/dancr/browser-session";
import { customerFacingDealDescription, customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";
import { CLUB_ARRIVAL_VERIFICATION, CLUB_TRANSPORTATION_TERMS, isEligibleClubTransportation, type EligibleClubTransportation } from "@/src/lib/dancr/club-deal-transportation";
import "./nfc-tap.css";

const DEAL_INTENT_KEY = "mydancrPendingNfcDealV2";
const VISIBILITY_DESCRIPTIONS: Record<VisibilityMode, string> = {
  internal: "Club roster and this club’s invited VIP guests.",
  external: "Public MyDancr discovery.",
  both: "Club roster, invited VIP guests, and public discovery.",
};

type TagState = {
  tag: { id: string; type: "dressing_room" | "cashier"; label: string };
  venue: { id: string; name: string; slug: string; city: string; state: string };
  deals: PublicClubDeal[];
};

type PendingDealIntent = {
  transportation: EligibleClubTransportation;
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
  const [visibility, setVisibility] = useState<VisibilityMode | "">("");
  const tapSessionRef = useRef("");
  const [auth, setAuth] = useState({ role: "", accessToken: "", refreshToken: "" });
  const autoSubmittedRef = useRef(false);
  const mountedRef = useRef(false);
  const tapAbortRef = useRef<AbortController | null>(null);
  const tapInFlightRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const pendingIntent = useMemo(() => readPendingDealIntent(token), [token]);

  useEffect(() => setAuth(readNfcAuthSession()), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      tapAbortRef.current?.abort();
      tapInFlightRef.current = false;
      if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    tapAbortRef.current?.abort();
    tapAbortRef.current = null;
    tapInFlightRef.current = false;
    autoSubmittedRef.current = false;
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    setState(null);
    setError("");
    setStatus("Reading club tag…");
    setPhase("reading");
    setIsSubmitting(false);
    setComplete(false);
    setDancerActivationComplete(false);
    setSelectedDealId("");
    setVisibility("");
    tapSessionRef.current = "";
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/nfc/${encodeURIComponent(token)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !data.ok) throw new Error(data.error || "This tap sticker is unavailable.");
        if (data.tag.type === "cashier") {
          window.location.replace(`/venues/${encodeURIComponent(data.venue.slug)}`);
          return;
        }
        setState(data);
        const pendingDealId = pendingIntent && pendingIntent.venueId === data.venue.id ? pendingIntent.dealId : "";
        const preferred = pendingDealId
          && data.deals?.some((deal: PublicClubDeal) => deal.id === pendingDealId)
          ? pendingDealId
          : "";
        setSelectedDealId(preferred || "");
        setPhase("ready");
        const preferredDeal = data.deals?.find((deal: PublicClubDeal) => deal.id === preferred);
        setStatus(data.tag.type === "dressing_room"
          ? ""
          : pendingIntent?.venueId === data.venue.id && preferredDeal
            ? `${preferredDeal.dealTitle} is selected. This registered cashier tap is completing the redemption automatically.`
          : data.deals?.length
            ? "No deal was selected. Open this club’s deal page, choose “Use this deal,” then tap this sticker again."
            : "This club has no active Club Deals right now.");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "This tap sticker is unavailable.");
        setStatus("");
        setPhase("error");
      });
    return () => controller.abort();
  }, [pendingIntent, token]);

  const submitTap = useCallback(async () => {
    if (!mountedRef.current || !state || tapInFlightRef.current) return;
    if (state.tag.type === "dressing_room" && !visibility) return;
    tapSessionRef.current ||= crypto.randomUUID();
    const controller = new AbortController();
    tapAbortRef.current?.abort();
    tapAbortRef.current = controller;
    tapInFlightRef.current = true;
    setIsSubmitting(true);
    setError("");
    setStatus("Verifying this tap with MyDancr…");
    setPhase("redeeming");
    try {
      const auth = readNfcAuthSession();
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
          sessionId: tapSessionRef.current,
          visibility,
          dealId: selectedDealId || null,
          sourceType: intent?.sourceType || "club_page",
          dancerId: intent?.dancerId || null,
          attributionToken: intent?.attributionToken || null,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to complete this phone tap.");
      persistRefreshedBrowserAuthSession(data.session, auth);
      if (state.tag.type === "cashier") clearPendingDealIntent();
      let completedDancerTap = state.tag.type === "dressing_room"
        && data.affiliation?.enrollmentStatus === "completed";
      if (state.tag.type === "dressing_room" && !completedDancerTap && !data.affiliation?.clubApprovalStatus) {
        const verificationResponse = await fetch("/api/dancer/dashboard", {
          headers,
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const verification = await verificationResponse.json();
        if (!mountedRef.current || controller.signal.aborted) return;
        completedDancerTap = verificationResponse.ok
          && verification.ok === true
          && (
            verification.nfc?.profileAuthorization?.authorized === true
            && verification.nfc?.profileAuthorization?.profileStatus === "approved"
          );
      }
      setDancerActivationComplete(completedDancerTap);
      setComplete(true);
      setPhase("redeemed");
      const successMessage = data.message || (state.tag.type === "cashier" ? "Club Deal redeemed." : "Club tap confirmed.");
      setStatus(completedDancerTap
        ? `${successMessage} ${externalTapRankingMessage(data.affiliation)} Opening your dancer dashboard…`
        : successMessage);
      if (completedDancerTap) {
        redirectTimerRef.current = window.setTimeout(() => {
          window.location.replace("/dashboard/dancer?nfc=complete");
        }, 700);
      }
    } catch (reason) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Unable to complete this phone tap.");
      setStatus(state?.tag.type === "dressing_room"
        ? "Profile activation was not completed. Step 3 remains open—stay at this sticker and try the tap again."
        : "The tap was not completed. Check the offer and try again at this sticker.");
      setPhase("error");
    } finally {
      if (tapAbortRef.current === controller) {
        tapAbortRef.current = null;
        tapInFlightRef.current = false;
        if (mountedRef.current) setIsSubmitting(false);
      }
    }
  }, [pendingIntent, selectedDealId, state, token, visibility]);

  useEffect(() => {
    if (autoSubmittedRef.current || !state || complete) return;
    const shouldSubmitCashierTap = state.tag.type === "cashier"
      && pendingIntent?.venueId === state.venue.id
      && pendingIntent.dealId === selectedDealId
      && state.deals.some((deal) => deal.id === selectedDealId);
    if (!shouldSubmitCashierTap) return;
    autoSubmittedRef.current = true;
    void submitTap();
  }, [auth.accessToken, auth.role, complete, pendingIntent, selectedDealId, state, submitTap]);

  const activeDeal = state?.deals.find((deal) => deal.id === selectedDealId) || null;
  const activeDealDescription = customerFacingDealDescription(activeDeal?.dealDescription);
  const activeDealTerms = customerFacingDealTerms(activeDeal?.dealTerms);
  const dancerNeedsSignIn = state?.tag.type === "dressing_room" && (auth.role !== "dancer" || !auth.accessToken);
  const exitHref = auth.role === "dancer" ? "/dashboard/dancer" : "/";
  const exitLabel = auth.role === "dancer" ? "Back to dancer dashboard" : "Back to MyDancr";

  return (
    <main className="nfc-page">
      <section className={`nfc-card${complete ? " complete" : ""}`} data-phase={phase} aria-busy={phase === "reading" || phase === "redeeming"}>
        <a className="nfc-exit" href={exitHref} data-close-control="" aria-label={exitLabel} title={exitLabel}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </a>
        <header className="nfc-heading">
          <div className="nfc-symbol"><NfcIcon /></div>
          <div className="nfc-venue">
            <span className="eyebrow">{state?.tag.type === "cashier" ? "Cashier tap redemption" : "Verified club tap"}</span>
            <h1>{state?.venue.name || "MyDancr tap"}</h1>
            {state ? <p>{state.venue.city}, {state.venue.state} · {state.tag.label}</p> : null}
          </div>
        </header>

        {state?.tag.type === "dressing_room" && !complete ? (
          <div className="nfc-action-copy">
            {dancerNeedsSignIn ? <><strong>Choose where you appear</strong><p>Sign in to choose your visibility.</p></> : null}
            {!dancerNeedsSignIn ? <fieldset className="nfc-visibility" disabled={isSubmitting}>
              <legend>Choose where you appear</legend>
              {VISIBILITY_OPTIONS.map(option => <label key={option.value}>
                <input type="radio" name="visibility" value={option.value} checked={visibility === option.value} onChange={() => { setVisibility(option.value); tapSessionRef.current = ""; }} />
                <span><strong>{option.label}</strong><small>{VISIBILITY_DESCRIPTIONS[option.value]}</small></span>
              </label>)}
            </fieldset> : null}
            <p className="nfc-checkin-note">Check-in lasts <strong>6 hours</strong>, followed by a <strong>6-hour cooldown across all clubs</strong>. Tapping again won&apos;t extend it.</p>
          </div>
        ) : null}

        {state?.tag.type === "cashier" && !complete ? (
          <div className="nfc-deals">
            <strong>Club Deal at the register</strong>
            {activeDeal ? (
              <article>
                <span>{dealTypeLabel(activeDeal.offerType)}</span>
                <h2>{activeDeal.dealTitle}</h2>
                {activeDealDescription ? <p>{activeDealDescription}</p> : null}
                {activeDealTerms ? <small>{activeDealTerms}</small> : null}
              </article>
            ) : <p>Select a current Club Deal before tapping this cashier sticker.</p>}
          </div>
        ) : null}

        {status || error ? <div className="nfc-feedback" data-state={error ? "error" : complete ? "success" : "info"}>
          {error ? <p className="nfc-error" role="alert">{error}</p> : null}
          {status ? <p className="nfc-status" role="status" aria-live="polite">{status}</p> : null}
        </div> : null}
        {state?.tag.type === "cashier" ? <div className="nfc-action-copy"><strong>Arrival eligibility</strong><p>{CLUB_TRANSPORTATION_TERMS}</p><p>{CLUB_ARRIVAL_VERIFICATION}</p></div> : null}

        {!complete && state ? (
          dancerNeedsSignIn ? (
            <>
              <Link className="nfc-primary" data-sign-in-action href={`/account?role=dancer&mode=login&venue_nfc=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/nfc/${token}`)}`}>
                Sign in to use venue tap
              </Link>
              <Link className="nfc-secondary" href={`/account?role=dancer&mode=signup&venue_nfc=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/nfc/${token}`)}`}>
                Create dancer account
              </Link>
            </>
          ) : state.tag.type === "cashier" && phase !== "error" ? null : (
            <button className="nfc-primary" type="button" onClick={submitTap} disabled={isSubmitting || (state.tag.type === "dressing_room" && !visibility)}>
              {isSubmitting
                ? "Confirming…"
                : phase === "error"
                  ? "Try again"
                : state.tag.type === "dressing_room"
                  ? "Confirm my choice & check in"
                  : "Try again"}
            </button>
          )
        ) : null}
        {state?.tag.type === "dressing_room" && !complete ? (
          <details className="nfc-help">
            <summary>How check-in works</summary>
            <p>Your first tap requests club approval. Once your profile, required media and club approval are ready, you check in for the time left in that tap’s six-hour window. After it expires, tap again when eligible. New media needs club approval and MyDancr’s final approval.</p>
            <p>For future check-ins, unlock your phone and tap the club&apos;s dancer check-in tag. Open the link and sign in if prompted. No particular page needs to be open.</p>
            <p>The internal roster shows your approved avatar and stage name. Customers can tap your avatar to view your full profile. Internal only includes this club’s invited VIP guests, who may be viewing remotely, and keeps you out of public MyDancr discovery.</p>
          </details>
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
      <p className="nfc-security">Only use MyDancr check-in tags physically posted by club staff. A disabled or replaced tag cannot authorize an action.</p>
    </main>
  );
}

function readNfcAuthSession() {
  const value = readBrowserAuthSession();
  return {
    role: value?.account?.role || "",
    accessToken: typeof value?.accessToken === "string" ? value.accessToken : "",
    refreshToken: typeof value?.refreshToken === "string" ? value.refreshToken : "",
  };
}

function readPendingDealIntent(routeToken: string): PendingDealIntent | null {
  if (!routeToken) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(DEAL_INTENT_KEY) || "null");
    if (!value || typeof value !== "object" || Date.now() - Number(value.savedAt || 0) > 12 * 60 * 60 * 1000) return null;
    if (typeof value.venueId !== "string" || typeof value.dealId !== "string") return null;
    if (!isEligibleClubTransportation(value.transportation)) return null;
    if (Number(value.expiresAt || 0) > 0 && Date.now() >= Number(value.expiresAt)) return null;
    return value as PendingDealIntent;
  } catch {
    return null;
  }
}

function clearPendingDealIntent() {
  try { window.localStorage.removeItem(DEAL_INTENT_KEY); } catch { /* storage is optional */ }
}

function dealTypeLabel(value: PublicClubDeal["offerType"]) {
  if (value === "other") return "Club offer";
  return "Admission offer";
}
