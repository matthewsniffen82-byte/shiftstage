"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";
import { customerFacingDealDescription, customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";
import { admissionOfferHours, clubArrivalLabel, CLUB_ARRIVAL_VERIFICATION } from "@/src/lib/dancr/club-deal-transportation";
import { requestDashboardJson } from "@/app/dashboard/dashboard-session";

const DEAL_SESSION_KEY = "mydancrDealSessionV1";

type RedeemDealClientProps = {
  token: string;
  initialRedemption: any;
};

export function RedeemDealClient({ token, initialRedemption }: RedeemDealClientProps) {
  const [redemption, setRedemption] = useState(initialRedemption);
  const [status, setStatus] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [venueAccessToken, setVenueAccessToken] = useState("");
  const [arrivalVerified, setArrivalVerified] = useState(false);
  const mountedRef = useRef(false);
  const redeemAbortRef = useRef<AbortController | null>(null);
  const redeemRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      redeemRequestIdRef.current += 1;
      redeemAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    redeemRequestIdRef.current += 1;
    redeemAbortRef.current?.abort();
    redeemAbortRef.current = null;
    setRedemption(initialRedemption);
    setStatus("");
    setIsRedeeming(false);
    setArrivalVerified(false);
  }, [initialRedemption, token]);

  useEffect(() => {
    const accessToken = readBrowserAccessToken("venue");
    setVenueAccessToken(accessToken);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }
    fetch(`/api/deals/redemptions/${encodeURIComponent(token)}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        eventType: "scanner_opened",
        sessionId: readDealSessionId(),
      }),
      keepalive: true,
    }).catch(() => null);
  }, [token]);

  async function redeem() {
    if (redeemAbortRef.current) return;
    const controller = new AbortController();
    const requestId = redeemRequestIdRef.current + 1;
    redeemRequestIdRef.current = requestId;
    redeemAbortRef.current = controller;
    setStatus("");
    setIsRedeeming(true);

    try {
      if (!venueAccessToken) {
        throw new Error("Sign in with the venue account that owns this club to confirm redemption.");
      }
      const data = await requestDashboardJson(`/api/deals/redeem/${encodeURIComponent(token)}`, {
        method: "POST",
        expectedRole: "venue",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ arrivalVerified }),
        fallbackMessage: "Unable to confirm this admission.",
        signal: controller.signal,
      });
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== redeemRequestIdRef.current
      ) return;
      if (!data.ok) throw new Error(data.error || "Unable to redeem this admission pass.");

      setRedemption(data.redemption);
      setStatus(data.alreadyRedeemed ? "Already used. Do not admit another guest with this pass." : "Admission confirmed. One verified visit recorded.");
    } catch (error) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== redeemRequestIdRef.current
      ) return;
      setStatus(error instanceof Error ? error.message : "Unable to redeem this Club Deal.");
    } finally {
      if (redeemAbortRef.current === controller) {
        redeemAbortRef.current = null;
        if (mountedRef.current) setIsRedeeming(false);
      }
    }
  }

  const deal = redemption?.deal;
  const dealDescription = customerFacingDealDescription(deal?.dealDescription);
  const dealTerms = customerFacingDealTerms(deal?.dealTerms);
  const venue = redemption?.venue;
  const isRedeemed = redemption?.status === "redeemed";
  const isValid = redemption?.isAdmissionPass && redemption?.status === "generated"
    && Date.parse(redemption.expiresAt) > Date.now() && deal?.isActive;

  return (
    <article className="scanner-card">
      <span className={`status-pill ${isRedeemed ? "success" : ""}`}>{isRedeemed ? "Already used" : isValid ? "Awaiting staff verification" : "Unavailable / expired"}</span>
      <h1>{deal?.dealTitle || "Club Deal"}</h1>
      <p>{dealDescription || "Show this screen to club staff."}</p>
      {dealTerms ? <small>{dealTerms}</small> : null}
      <dl>
        <div>
          <dt>Club</dt>
          <dd>{venue?.name || "Club"}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{redemption?.expiresAt ? formatDate(redemption.expiresAt) : "Tonight"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{redemption?.sourceType === "dancer_profile" ? "Dancer profile" : "Club page"}</dd>
        </div>
      </dl>
      <p><strong>Arrival method: {clubArrivalLabel(redemption?.arrivalMethod)}</strong></p>
      <small>{CLUB_ARRIVAL_VERIFICATION}</small>
      {admissionOfferHours(deal) ? <small>Offer hours: {admissionOfferHours(deal)} (venue local time)</small> : null}
      {isValid && venueAccessToken ? <label className="arrival-verification"><input type="checkbox" checked={arrivalVerified} disabled={isRedeeming} onChange={event => setArrivalVerified(event.target.checked)} /> I verified this guest’s eligible arrival method and admission requirements.</label> : null}
      <button
        type="button"
        onClick={redeem}
        disabled={isRedeeming || !isValid || !venueAccessToken || !arrivalVerified}
      >
        {isRedeemed ? "Already used" : isRedeeming ? "Confirming…" : "Admit guest & redeem pass"}
      </button>
      {!venueAccessToken ? (
        <Link
          className="venue-sign-in"
          href={`/?venueAccess=1&venueMode=login&return_to=${encodeURIComponent(`/deals/redeem/${token}`)}`}
        >
          Club staff sign in to confirm
        </Link>
      ) : null}
      <small>
        Only authorized staff for {venue?.name || "this club"} can redeem this pass. Each pass admits one guest.
      </small>
      {status ? <em>{status}</em> : null}
    </article>
  );
}

function readDealSessionId() {
  try {
    const existing = window.localStorage.getItem(DEAL_SESSION_KEY) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(DEAL_SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Tonight";
  }
}
