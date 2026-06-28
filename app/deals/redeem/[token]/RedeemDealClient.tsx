"use client";

import { useState } from "react";

type RedeemDealClientProps = {
  token: string;
  initialRedemption: any;
};

export function RedeemDealClient({ token, initialRedemption }: RedeemDealClientProps) {
  const [redemption, setRedemption] = useState(initialRedemption);
  const [status, setStatus] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);

  async function redeem() {
    setStatus("");
    setIsRedeeming(true);

    try {
      const response = await fetch(`/api/deals/redeem/${encodeURIComponent(token)}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to redeem this QR code.");

      setRedemption(data.redemption);
      setStatus("Redeemed. Deal is valid.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to redeem this QR code.");
    } finally {
      setIsRedeeming(false);
    }
  }

  const deal = redemption?.deal;
  const venue = redemption?.venue;
  const isRedeemed = redemption?.status === "redeemed";

  return (
    <article className="scanner-card">
      <span className={`status-pill ${isRedeemed ? "success" : ""}`}>{redemption?.status || "unknown"}</span>
      <h1>{deal?.dealTitle || "Club Deal"}</h1>
      <p>{deal?.dealDescription || "Show this screen to club staff."}</p>
      {deal?.dealTerms ? <small>{deal.dealTerms}</small> : null}
      <dl>
        <div>
          <dt>Venue</dt>
          <dd>{venue?.name || "Venue"}</dd>
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
      <button type="button" onClick={redeem} disabled={isRedeeming || isRedeemed || redemption?.status !== "generated"}>
        {isRedeemed ? "Already Redeemed" : isRedeeming ? "Redeeming..." : "Redeem Deal"}
      </button>
      {status ? <em>{status}</em> : null}
    </article>
  );
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
