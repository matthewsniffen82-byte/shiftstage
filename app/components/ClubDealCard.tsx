"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClubDeal, DealSourceType } from "@/src/lib/dancr/types";

const SESSION_KEY = "dancrAuthSessionV1";
const DEAL_SESSION_KEY = "mydancrDealSessionV1";

type ClubDealCardProps = {
  deal: ClubDeal;
  venueId: string;
  venueName?: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
  attributionToken?: string | null;
  dancerNote?: boolean;
  compact?: boolean;
  presentation?: "card" | "launcher";
  ctaLabel?: string;
  stickyCta?: boolean;
  sectionId?: string;
};

export function ClubDealCard({
  deal,
  venueId,
  venueName,
  sourceType,
  dancerId,
  attributionToken,
  dancerNote,
  compact,
  presentation = "card",
  ctaLabel,
  stickyCta = false,
  sectionId,
}: ClubDealCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [redemptionToken, setRedemptionToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const passUrl = redemptionToken ? `/deals/pass/${encodeURIComponent(redemptionToken)}` : "";
  const actionLabel = ctaLabel || "Get Club Deal";

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialogOpen]);

  async function generateDealQr(openDialog = presentation === "launcher") {
    setStatus("");
    setIsLoading(true);
    if (openDialog) setDialogOpen(true);

    try {
      const session = readCustomerSession();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (session.accessToken) headers.authorization = `Bearer ${session.accessToken}`;

      const response = await fetch("/api/deals/redemptions", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          clubDealId: deal.id,
          venueId,
          sourceType,
          dancerId: sourceType === "dancer_profile" ? dancerId : null,
          attributionToken: sourceType === "dancer_profile" ? attributionToken : null,
          sessionId: readOrCreateDealSessionId(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to create this QR code.");

      setQrDataUrl(data.qrDataUrl);
      setRedemptionToken(data.redemption?.redemptionToken || "");
      setExpiresAt(data.redemption?.expiresAt || "");
      if (session.accessToken && data.redemption?.redemptionToken) {
        await recordLifecycleEvent(data.redemption.redemptionToken, "saved");
      }
      setStatus(session.accessToken
        ? "QR ready and saved to your customer dashboard."
        : "QR ready. Save or share it before you go.");
    } catch (error) {
      setQrDataUrl("");
      setRedemptionToken("");
      setExpiresAt("");
      setStatus(error instanceof Error ? error.message : "Unable to create this QR code.");
    } finally {
      setIsLoading(false);
    }
  }

  async function downloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `mydancr-${slugify(venueName || deal.dealTitle)}-club-deal.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    await recordLifecycleEvent(redemptionToken, "saved");
    setStatus("QR image saved.");
  }

  async function sharePass() {
    if (!passUrl) return;
    const absoluteUrl = new URL(passUrl, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({
          title: deal.dealTitle,
          text: `${deal.dealTitle}${venueName ? ` at ${venueName}` : ""}`,
          url: absoluteUrl,
        });
        await recordLifecycleEvent(redemptionToken, "shared");
        setStatus("Club Deal shared.");
        return;
      }
      await navigator.clipboard.writeText(absoluteUrl);
      await recordLifecycleEvent(redemptionToken, "shared");
      setStatus("Club Deal link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Unable to share this Club Deal.");
    }
  }

  const dealContent = (
    <>
      <div className="club-deal-copy">
        <span className="eyebrow">Club Deal</span>
        <h2>{deal.dealTitle}</h2>
        {!compact ? <p>{deal.dealDescription}</p> : null}
        {deal.dealTerms && !compact ? <small>{deal.dealTerms}</small> : null}
        {!compact ? <small>Get your unique QR and show it at the venue. No sign-in is required.</small> : null}
        {dancerNote ? (
          <small>Dancer credit is locked when the QR is issued during a verified check-in and stays attached when saved or shared.</small>
        ) : null}
      </div>
      <div className="club-deal-action">
        {qrDataUrl ? (
          <div className="deal-qr-frame">
            <img src={qrDataUrl} alt={`${deal.dealTitle} QR code`} />
            <span>{expiresAt ? `Expires ${formatExpiry(expiresAt)}` : "Ready for club scan"}</span>
          </div>
        ) : null}
        <button type="button" onClick={() => generateDealQr(false)} disabled={isLoading}>
          {isLoading ? "Creating your QR…" : qrDataUrl ? "Refresh QR" : actionLabel}
        </button>
        {qrDataUrl ? (
          <div className="club-deal-pass-actions">
            <button type="button" onClick={downloadQr}>Save QR</button>
            <button type="button" onClick={sharePass}>Share</button>
            {passUrl ? <Link href={passUrl}>View later</Link> : null}
          </div>
        ) : null}
        {status ? <em role="status">{status}</em> : null}
      </div>
    </>
  );

  return (
    <>
      {presentation === "launcher" ? (
        <button
          className="club-deal-launcher"
          type="button"
          onClick={() => generateDealQr(true)}
          disabled={isLoading}
        >
          <span>Club Deal</span>
          <strong>{isLoading ? "Creating QR…" : actionLabel}</strong>
        </button>
      ) : (
        <article
          className={`club-deal-card${compact ? " compact" : ""}`}
          id={sectionId}
        >
          {dealContent}
        </article>
      )}

      {stickyCta ? (
        <button
          className="club-deal-sticky"
          type="button"
          onClick={() => generateDealQr(true)}
          disabled={isLoading}
        >
          <span>{deal.dealTitle}</span>
          <strong>{isLoading ? "Creating QR…" : "Get Club Deal"}</strong>
        </button>
      ) : null}

      {dialogOpen ? (
        <div
          className="club-deal-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <section
            className="club-deal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${deal.dealTitle} Club Deal`}
          >
            <button
              className="club-deal-dialog-close"
              type="button"
              aria-label="Close Club Deal"
              autoFocus
              onClick={() => setDialogOpen(false)}
            >
              ×
            </button>
            {dealContent}
          </section>
        </div>
      ) : null}

      <ClubDealInteractionStyles />
    </>
  );
}

async function recordLifecycleEvent(
  token: string,
  eventType: "saved" | "shared",
) {
  if (!token) return;
  const session = readCustomerSession();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
  await fetch(`/api/deals/redemptions/${encodeURIComponent(token)}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      eventType,
      sessionId: readOrCreateDealSessionId(),
    }),
    keepalive: true,
  }).catch(() => null);
}

function readCustomerSession() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return {
      accessToken: session?.account?.role === "customer" && typeof session?.accessToken === "string"
        ? session.accessToken
        : "",
    };
  } catch {
    return { accessToken: "" };
  }
}

function readOrCreateDealSessionId() {
  try {
    const existing = window.localStorage.getItem(DEAL_SESSION_KEY) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(DEAL_SESSION_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "club-deal";
}

function formatExpiry(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "soon";
  }
}

function ClubDealInteractionStyles() {
  return (
    <style>{`
      .club-deal-launcher { width: fit-content; max-width: 100%; min-height: 48px; display: grid; gap: 1px; justify-items: start; padding: 7px 16px; border: 1px solid rgba(126,234,255,.56); border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); box-shadow: 0 12px 30px rgba(35,114,178,.3), 0 0 20px rgba(126,234,255,.12); font: inherit; text-align: left; cursor: pointer; }
      .club-deal-launcher span { color: #d8f7ff; font-size: 9px; font-weight: 950; letter-spacing: .14em; line-height: 1; text-transform: uppercase; }
      .club-deal-launcher strong { max-width: 230px; overflow: hidden; font-size: 13px; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-launcher:disabled, .club-deal-sticky:disabled { opacity: .72; cursor: wait; }
      .club-deal-pass-actions { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .club-deal-pass-actions button, .club-deal-pass-actions a { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; border: 1px solid rgba(126,234,255,.28); border-radius: 999px; color: #fff; background: rgba(126,234,255,.08); font: inherit; font-size: 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .club-deal-dialog-backdrop { position: fixed; z-index: 1700; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.82); backdrop-filter: blur(12px); }
      .club-deal-dialog { position: relative; width: min(430px, 100%); max-height: min(86dvh, 760px); display: grid; gap: 18px; overflow-y: auto; box-sizing: border-box; padding: 24px; border: 1px solid rgba(126,234,255,.42); border-radius: 18px; color: #f7f2ff; background: radial-gradient(circle at 82% 5%, rgba(34,199,255,.14), transparent 16rem), linear-gradient(145deg, #0d0a18, #050507); box-shadow: 0 28px 90px rgba(0,0,0,.72), 0 0 36px rgba(109,40,217,.2); }
      .club-deal-dialog-close { position: absolute; z-index: 2; top: 10px; right: 10px; width: 40px; height: 40px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.38); border-radius: 50%; color: #fff; background: rgba(5,5,7,.82); font: inherit; font-size: 26px; cursor: pointer; }
      .club-deal-dialog .club-deal-copy { padding-right: 34px; }
      .club-deal-dialog .club-deal-copy h2 { margin: 0; font-size: clamp(23px, 6vw, 32px); }
      .club-deal-dialog .club-deal-copy p { color: #cfc5de; font-size: 15px; line-height: 1.45; }
      .club-deal-dialog .club-deal-copy small, .club-deal-dialog .club-deal-action em { color: #b9accd; font-size: 12px; line-height: 1.4; font-style: normal; }
      .club-deal-dialog .club-deal-action { display: grid; gap: 12px; }
      .club-deal-dialog .club-deal-action > button { min-height: 48px; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font: inherit; font-weight: 950; cursor: pointer; }
      .club-deal-dialog .deal-qr-frame { display: grid; justify-items: center; gap: 8px; padding: 14px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(0,0,0,.34); }
      .club-deal-dialog .deal-qr-frame img { width: min(240px, 70vw); aspect-ratio: 1; border-radius: 10px; background: #fff; }
      .club-deal-dialog .deal-qr-frame span { color: #d8f7ff; font-size: 12px; font-weight: 900; }
      .club-deal-sticky { display: none; }
      @media (max-width: 760px) {
        .club-deal-sticky { position: fixed; z-index: 95; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border: 1px solid rgba(126,234,255,.58); border-radius: 16px; color: #fff; background: linear-gradient(135deg, rgba(50,18,115,.98), rgba(5,126,165,.98)); box-shadow: 0 18px 50px rgba(0,0,0,.68), 0 0 28px rgba(34,199,255,.22); font: inherit; text-align: left; cursor: pointer; }
        .club-deal-sticky span { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
        .club-deal-sticky strong { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 12px; color: #061015; background: #7eeaff; font-size: 13px; font-weight: 950; white-space: nowrap; }
        .club-deal-pass-actions { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
