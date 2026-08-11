"use client";

import { useEffect, useRef, useState } from "react";
import type { ClubDeal, DealSourceType } from "@/src/lib/dancr/types";

const DEAL_INTENT_KEY = "mydancrPendingNfcDealV1";

type ClubDealCardProps = {
  deal: ClubDeal;
  deals?: ClubDeal[];
  venueId: string;
  venueName?: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
  attributionToken?: string | null;
  attributionTokens?: Record<string, string>;
  dancerNote?: boolean;
  compact?: boolean;
  presentation?: "card" | "launcher";
  ctaLabel?: string;
  stickyCta?: boolean;
  sectionId?: string;
};

export function ClubDealCard({
  deal,
  deals,
  venueId,
  venueName,
  sourceType,
  dancerId,
  attributionToken,
  attributionTokens,
  dancerNote,
  compact,
  presentation = "card",
  ctaLabel,
  stickyCta = false,
  sectionId,
}: ClubDealCardProps) {
  const [status, setStatus] = useState("");
  const [intentSaved, setIntentSaved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogReturnContext = useRef<{
    windowScrollY: number;
    scrollContainer: HTMLElement | null;
    scrollTop: number;
    focusTarget: HTMLElement | null;
  } | null>(null);
  const offerDeals = deals?.length ? deals : [deal];
  const [selectedDealId, setSelectedDealId] = useState(deal.id);
  const activeDeal = offerDeals.find((offer) => offer.id === selectedDealId) || offerDeals[0] || deal;
  const actionLabel = ctaLabel || (offerDeals.length > 1 ? `Club Deals · ${offerDeals.length}` : "Use Club Deal");

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

  useEffect(() => {
    if (dialogOpen || !dialogReturnContext.current) return;
    const returnContext = dialogReturnContext.current;
    dialogReturnContext.current = null;
    let secondFrame = 0;
    const restorePosition = () => {
      if (returnContext.scrollContainer?.isConnected) {
        returnContext.scrollContainer.scrollTop = returnContext.scrollTop;
      }
      window.scrollTo({ top: returnContext.windowScrollY, left: 0, behavior: "auto" });
    };
    const firstFrame = window.requestAnimationFrame(() => {
      restorePosition();
      secondFrame = window.requestAnimationFrame(() => {
        restorePosition();
        if (returnContext.focusTarget?.isConnected) {
          returnContext.focusTarget.focus({ preventScroll: true });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [dialogOpen]);

  function openDealDialog(triggerButton: HTMLElement | null) {
    if (!dialogOpen && !dialogReturnContext.current) {
      const scrollContainer = triggerButton?.closest<HTMLElement>("#results.venue-profile-overlay") || null;
      dialogReturnContext.current = {
        windowScrollY: window.scrollY,
        scrollContainer,
        scrollTop: scrollContainer?.scrollTop || 0,
        focusTarget: triggerButton,
      };
    }
    setDialogOpen(true);
  }

  function saveForNfcTap() {
    setStatus("");
    try {
      window.localStorage.setItem(DEAL_INTENT_KEY, JSON.stringify({
        venueId,
        dealId: activeDeal.id,
        sourceType,
        dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
        attributionToken: sourceType === "dancer_profile"
          ? attributionTokens?.[activeDeal.id] || attributionToken || null
          : null,
        savedAt: Date.now(),
      }));
      setIntentSaved(true);
      setStatus(`Ready. At ${venueName || "the club"}, tap the MyDancr NFC sticker at the cashier to redeem.`);
    } catch (error) {
      setIntentSaved(false);
      setStatus(error instanceof Error ? error.message : "Unable to save this Club Deal on this device.");
    }
  }

  const dealContent = (
    <>
      <div className="club-deal-copy">
        <span className="eyebrow">{dealTypeLabel(activeDeal.offerType)} · Club Deal</span>
        <h2>{activeDeal.dealTitle}</h2>
        {!compact ? <p>{activeDeal.dealDescription}</p> : null}
        {activeDeal.dealTerms && !compact ? <small>{activeDeal.dealTerms}</small> : null}
        {!compact ? <small>Tap the MyDancr NFC sticker at the cashier to redeem. No sign-in is required.</small> : null}
        {dancerNote ? (
          <small>Dancer credit is carried securely to the cashier NFC tap while this dancer remains verified at the club.</small>
        ) : null}
      </div>
      <div className="club-deal-action">
        {intentSaved ? (
          <div className="deal-nfc-ready">
            <span aria-hidden="true">)))</span>
            <strong>Ready for cashier tap</strong>
            <small>Open this site by tapping the club&apos;s MyDancr NFC sticker.</small>
          </div>
        ) : null}
        <button type="button" onClick={saveForNfcTap}>
          {intentSaved ? "Change saved offer" : actionLabel}
        </button>
        {status ? <em role="status">{status}</em> : null}
        {intentSaved && activeDeal.offerType === "bottle_service" && activeDeal.bookingUrl ? (
          <a className="club-deal-booking-link" href={activeDeal.bookingUrl} target="_blank" rel="noreferrer">
            Continue to club booking
          </a>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      {presentation === "launcher" ? (
        <button
          className="club-deal-launcher"
          type="button"
          onClick={(event) => {
            openDealDialog(event.currentTarget);
            if (offerDeals.length === 1) saveForNfcTap();
          }}
        >
          <span>{offerDeals.length > 1 ? `${offerDeals.length} live offers` : "Club Deal"}</span>
          <strong>{actionLabel}</strong>
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
          onClick={(event) => {
            openDealDialog(event.currentTarget);
            if (offerDeals.length === 1) saveForNfcTap();
          }}
        >
          <span>{deal.dealTitle}</span>
          <strong>Club Deals</strong>
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
            aria-label={`${venueName || "Club"} Club Deals`}
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
            {offerDeals.length > 1 && !intentSaved ? (
              <div className="club-deal-offer-picker">
                <span className="eyebrow">Choose your offer</span>
                <h2>{venueName ? `Club Deals at ${venueName}` : "Club Deals"}</h2>
                <div>
                  {offerDeals.map((offer) => (
                    <button
                      className={offer.id === activeDeal.id ? "active" : ""}
                      key={offer.id}
                      type="button"
                      onClick={() => {
                        setSelectedDealId(offer.id);
                        setIntentSaved(false);
                        setStatus("");
                      }}
                    >
                      <span>{dealTypeLabel(offer.offerType)}</span>
                      <strong>{offer.dealTitle}</strong>
                      <small>{offer.dealDescription}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {dealContent}
          </section>
        </div>
      ) : null}

      <ClubDealInteractionStyles />
    </>
  );
}

function dealTypeLabel(value: ClubDeal["offerType"]) {
  if (value === "drink") return "Drink offer";
  if (value === "bottle_service") return "Bottle service";
  if (value === "other") return "Club offer";
  return "Admission offer";
}

function ClubDealInteractionStyles() {
  return (
    <style>{`
      .club-deal-launcher { width: fit-content; max-width: 100%; min-height: 48px; display: grid; gap: 1px; justify-items: start; padding: 7px 16px; border: 1px solid var(--dancr-color-success-medium); border-radius: 999px; color: #fff; background: color-mix(in srgb, var(--dancr-color-success) 14%, var(--dancr-color-surface)); box-shadow: 0 8px 18px var(--dancr-color-black-soft); font: inherit; text-align: left; cursor: pointer; }
      .club-deal-launcher span { color: #d8f7ff; font-size: 9px; font-weight: 950; letter-spacing: .14em; line-height: 1; text-transform: uppercase; }
      .club-deal-launcher strong { max-width: 230px; overflow: hidden; font-size: 13px; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-dialog-backdrop { position: fixed; z-index: 1700; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.82); backdrop-filter: blur(12px); }
      .club-deal-dialog { position: relative; width: min(430px, 100%); max-height: min(86dvh, 760px); display: grid; gap: 18px; overflow-y: auto; box-sizing: border-box; padding: 24px; border: 1px solid var(--dancr-color-border-subtle); border-radius: 18px; color: #f7f2ff; background: var(--dancr-color-surface-translucent); box-shadow: var(--dancr-shadow-modal); }
      .club-deal-dialog-close { position: absolute; z-index: 2; top: 10px; right: 10px; width: 40px; height: 40px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.38); border-radius: 50%; color: #fff; background: rgba(5,5,7,.82); font: inherit; font-size: 26px; cursor: pointer; }
      .club-deal-dialog .club-deal-copy { padding-right: 34px; }
      .club-deal-dialog .club-deal-copy h2 { margin: 0; font-size: clamp(23px, 6vw, 32px); }
      .club-deal-dialog .club-deal-copy p { color: #cfc5de; font-size: 15px; line-height: 1.45; }
      .club-deal-dialog .club-deal-copy small, .club-deal-dialog .club-deal-action em { color: #b9accd; font-size: 12px; line-height: 1.4; font-style: normal; }
      .club-deal-dialog .club-deal-action { display: grid; gap: 12px; }
      .club-deal-dialog .club-deal-action > button { min-height: 48px; border: 1px solid var(--dancr-color-success-medium); border-radius: 999px; color: #fff; background: color-mix(in srgb, var(--dancr-color-success) 18%, var(--dancr-color-surface)); font: inherit; font-weight: 950; cursor: pointer; }
      .club-deal-dialog .deal-nfc-ready { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:4px 12px; padding:16px; border:1px solid rgba(89,255,176,.28); border-radius:14px; background:rgba(35,196,118,.08); }
      .club-deal-dialog .deal-nfc-ready>span { grid-row:1 / 3; width:44px; height:44px; display:grid; place-items:center; border-radius:50%; color:#fff; background:#5421d4; font-weight:950; letter-spacing:-5px; transform:rotate(-18deg); }
      .club-deal-dialog .deal-nfc-ready strong { color:#d8ffeb; font-size:14px; }
      .club-deal-dialog .deal-nfc-ready small { color:#a9c7b7; font-size:11px; line-height:1.35; }
      .club-deal-booking-link { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid rgba(126,234,255,.36); border-radius: 999px; color: #061015; background: #7eeaff; font-size: 13px; font-weight: 950; text-decoration: none; }
      .club-deal-offer-picker { display: grid; gap: 10px; }
      .club-deal-offer-picker h2 { margin: 0; padding-right: 34px; font-size: clamp(22px, 6vw, 30px); }
      .club-deal-offer-picker > div { display: grid; gap: 8px; }
      .club-deal-offer-picker button { display: grid; justify-items: start; gap: 4px; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; color: #fff; background: rgba(255,255,255,.04); font: inherit; text-align: left; cursor: pointer; }
      .club-deal-offer-picker button.active { border-color: var(--dancr-color-success-medium); background: color-mix(in srgb, var(--dancr-color-success) 12%, var(--dancr-color-surface)); }
      .club-deal-offer-picker button span { color: #78ffc0; font-size: 9px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .club-deal-offer-picker button strong { font-size: 15px; }
      .club-deal-offer-picker button small { color: #b9accd; font-size: 12px; line-height: 1.35; }
      .club-deal-sticky { display: none; }
      @media (max-width: 760px) {
        .club-deal-sticky { position: fixed; z-index: 95; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border: 1px solid var(--dancr-color-success-medium); border-radius: 16px; color: #fff; background: var(--dancr-color-surface-translucent); box-shadow: 0 18px 50px rgba(0,0,0,.68); font: inherit; text-align: left; cursor: pointer; }
        .club-deal-sticky span { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
        .club-deal-sticky strong { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 12px; color: #061015; background: #7eeaff; font-size: 13px; font-weight: 950; white-space: nowrap; }
      }
    `}</style>
  );
}
