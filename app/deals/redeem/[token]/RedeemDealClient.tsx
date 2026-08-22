"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";
import { customerFacingDealDescription, customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";

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
    setStatus("");
    setIsRedeeming(true);

    try {
      if (!venueAccessToken) {
        throw new Error("Sign in with the venue account that owns this club to confirm redemption.");
      }
      const response = await fetch(`/api/deals/redeem/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${venueAccessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to redeem this Club Deal.");

      setRedemption(data.redemption);
      setStatus("Redeemed. This verified visit was recorded for MyDancr club billing.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to redeem this Club Deal.");
    } finally {
      setIsRedeeming(false);
    }
  }

  const deal = redemption?.deal;
  const dealDescription = customerFacingDealDescription(deal?.dealDescription);
  const dealTerms = customerFacingDealTerms(deal?.dealTerms);
  const venue = redemption?.venue;
  const isRedeemed = redemption?.status === "redeemed";

  return (
    <article className="scanner-card">
      <span className={`status-pill ${isRedeemed ? "success" : ""}`}>{redemption?.status || "unknown"}</span>
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
        <div>
          <dt>Referral commission</dt>
          <dd>{formatMoney(Number(deal?.referralCommissionCents || 0))}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={redeem}
        disabled={isRedeeming || isRedeemed || redemption?.status !== "generated" || !venueAccessToken}
      >
        {isRedeemed ? "Already Redeemed" : isRedeeming ? "Redeeming..." : "Redeem Deal"}
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
        Only the authenticated account that owns {venue?.name || "this club"} can create a successful redemption.
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

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.max(0, cents) / 100);
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
