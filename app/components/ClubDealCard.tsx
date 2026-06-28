"use client";

import { useState } from "react";
import type { ClubDeal, DealSourceType } from "@/src/lib/dancr/types";

type ClubDealCardProps = {
  deal: ClubDeal;
  venueId: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
  dancerNote?: boolean;
};

export function ClubDealCard({ deal, venueId, sourceType, dancerId, dancerNote }: ClubDealCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function generateDealQr() {
    setStatus("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/deals/redemptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubDealId: deal.id,
          venueId,
          sourceType,
          dancerId: sourceType === "dancer_profile" ? dancerId : null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to create this QR code.");

      setQrDataUrl(data.qrDataUrl);
      setExpiresAt(data.redemption?.expiresAt || "");
      setStatus("Show this QR at the venue.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create this QR code.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <article className="club-deal-card">
      <div className="club-deal-copy">
        <span className="eyebrow">Official club deal</span>
        <h2>{deal.dealTitle}</h2>
        <p>{deal.dealDescription}</p>
        {deal.dealTerms ? <small>{deal.dealTerms}</small> : null}
        {dancerNote ? (
          <small>This is the same club deal offered on the venue page. Using it from this profile may support this dancer.</small>
        ) : null}
      </div>
      <div className="club-deal-action">
        {qrDataUrl ? (
          <div className="deal-qr-frame">
            <img src={qrDataUrl} alt="Club deal QR code" />
            <span>{expiresAt ? `Expires ${formatExpiry(expiresAt)}` : "Ready for club scan"}</span>
          </div>
        ) : null}
        <button type="button" onClick={generateDealQr} disabled={isLoading}>
          {isLoading ? "Creating..." : qrDataUrl ? "Refresh QR" : "Get Club Deal"}
        </button>
        {status ? <em>{status}</em> : null}
      </div>
    </article>
  );
}

function formatExpiry(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "tonight";
  }
}
