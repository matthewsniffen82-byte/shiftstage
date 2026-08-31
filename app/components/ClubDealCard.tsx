"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ClubDeal, DealSourceType } from "@/src/lib/dancr/types";
import { customerFacingDealDescription, customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";
import {
  hasSignedInCustomerDealAccount,
  loadCustomerDealSavedState,
  setCustomerDealSavedInAccount,
} from "@/src/lib/dancr/customer-deal-saves-client";
import NfcIcon from "@/app/components/NfcIcon";

const DEAL_INTENT_KEY = "mydancrPendingNfcDealV2";
const SAVED_DEALS_KEY = "dancrSavedDealPassesV2";
const DEAL_INTENT_TTL_MS = 12 * 60 * 60 * 1000;

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
  presentation?: "card" | "launcher" | "profileCompact";
  contextLabel?: string;
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
  contextLabel,
  ctaLabel,
  stickyCta = false,
  sectionId,
}: ClubDealCardProps) {
  const [status, setStatus] = useState("");
  const [intentState, setIntentState] = useState<"preview" | "ready" | "expired" | "error">("preview");
  const [intentExpiresAt, setIntentExpiresAt] = useState(0);
  const [savedOnDevice, setSavedOnDevice] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const termsId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogReturnContext = useRef<{
    windowScrollY: number;
    scrollContainer: HTMLElement | null;
    scrollTop: number;
    focusTarget: HTMLElement | null;
  } | null>(null);
  const offerDeals = deals?.length ? deals : [deal];
  const [selectedDealId, setSelectedDealId] = useState(deal.id);
  const activeDeal = offerDeals.find((offer) => offer.id === selectedDealId) || offerDeals[0] || deal;
  const displayDescription = customerFacingDealDescription(activeDeal.dealDescription);
  const displayTerms = customerFacingDealTerms(activeDeal.dealTerms);
  const actionLabel = ctaLabel || (offerDeals.length > 1 ? `Club Deals · ${offerDeals.length}` : "Use Club Deal");

  useEffect(() => {
    const selection = readPendingDealSelection({ venueId, dealId: activeDeal.id, sourceType, dancerId });
    setIntentState(selection?.expired ? "expired" : selection ? "ready" : "preview");
    setIntentExpiresAt(selection?.expiresAt || 0);
    setSavedOnDevice(isDealSavedOnDevice(venueId, activeDeal.id));
    setStatus(selection?.expired
      ? "Your previous selection expired. Select this deal again before tapping at the cashier."
      : "");
  }, [activeDeal.id, dancerId, sourceType, venueId, venueName]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCustomerDealSavedState(activeDeal.id, controller.signal)
      .then((saved) => {
        if (!controller.signal.aborted && typeof saved === "boolean") setSavedOnDevice(saved);
      })
      .catch(() => {
        // Keep the device copy usable if private account state cannot load.
      });
    return () => controller.abort();
  }, [activeDeal.id]);

  useEffect(() => {
    setTermsExpanded(false);
  }, [activeDeal.id, dialogOpen]);

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

  function selectForNfcTap() {
    setStatus("");
    try {
      const selectedAt = Date.now();
      const expiresAt = selectedAt + DEAL_INTENT_TTL_MS;
      window.localStorage.setItem(DEAL_INTENT_KEY, JSON.stringify({
        venueId,
        dealId: activeDeal.id,
        sourceType,
        dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
        attributionToken: sourceType === "dancer_profile"
          ? attributionTokens?.[activeDeal.id] || attributionToken || null
          : null,
        savedAt: selectedAt,
        expiresAt,
      }));
      setIntentState("ready");
      setIntentExpiresAt(expiresAt);
      setStatus("");
    } catch {
      setIntentState("error");
      setIntentExpiresAt(0);
      setStatus("Couldn’t prepare this deal. Allow site storage, then try again.");
    }
  }

  async function saveForLater() {
    if (savePending) return;
    setSavePending(true);
    const hasCustomerAccount = hasSignedInCustomerDealAccount();
    try {
      if (hasCustomerAccount) {
        await setCustomerDealSavedInAccount({
          dealId: activeDeal.id,
          saved: true,
          sourceType,
          dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
        });
      }
      let savedOnThisDevice = false;
      try {
        const saved = readSavedDeals();
        const id = savedDealId(venueId, activeDeal.id);
        const deviceDeal = {
          id,
          venueId,
          venueName: venueName || "Club",
          dealId: activeDeal.id,
          title: activeDeal.dealTitle,
          description: displayDescription,
          terms: displayTerms,
          offerType: activeDeal.offerType,
          sourceType,
          dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
          savedAt: new Date().toISOString(),
          nfcIntent: true,
          url: window.location.href,
        };
        const next = hasCustomerAccount
          ? saved.filter((item) => item.id !== id)
          : [deviceDeal, ...saved.filter((item) => item.id !== id)].slice(0, 20);
        window.localStorage.setItem(SAVED_DEALS_KEY, JSON.stringify(next));
        savedOnThisDevice = true;
      } catch {
        // The private account remains the source of truth when device storage is blocked.
      }
      if (!hasCustomerAccount && !savedOnThisDevice) {
        setSavedOnDevice(false);
        setStatus("Browser storage blocked saving this deal. Allow site storage and try again.");
        return;
      }
      setSavedOnDevice(true);
      setStatus(hasCustomerAccount
        ? "Saved privately to your account. This does not reserve or redeem the deal."
        : "Saved on this device. Sign in to keep it across devices. This does not redeem the deal.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save this Club Deal.");
    } finally {
      setSavePending(false);
    }
  }

  async function removeSavedDeal() {
    if (savePending) return;
    setSavePending(true);
    const hasCustomerAccount = hasSignedInCustomerDealAccount();
    try {
      if (hasCustomerAccount) {
        await setCustomerDealSavedInAccount({
          dealId: activeDeal.id,
          saved: false,
          sourceType,
          dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
        });
      }
      let removedFromDevice = false;
      try {
        const id = savedDealId(venueId, activeDeal.id);
        const next = readSavedDeals().filter((item) => item.id !== id);
        window.localStorage.setItem(SAVED_DEALS_KEY, JSON.stringify(next));
        removedFromDevice = true;
      } catch {
        // The private account remains the source of truth when device storage is blocked.
      }
      if (!hasCustomerAccount && !removedFromDevice) {
        setSavedOnDevice(true);
        setStatus("Browser storage blocked removing this deal. Allow site storage and try again.");
        return;
      }
      setSavedOnDevice(false);
      setStatus(hasCustomerAccount
        ? "Removed from your private saved deals. You can still use it at the cashier."
        : "Removed from saved deals. You can still use it at the cashier.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove this saved Club Deal.");
    } finally {
      setSavePending(false);
    }
  }

  async function shareDeal() {
    const url = window.location.href;
    const shareData = {
      title: `${venueName || "Club"} Club Deal`,
      text: `${activeDeal.dealTitle} at ${venueName || "the club"}.`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setStatus("Deal shared.");
      } else {
        await copyDealLink(url);
        setStatus("Deal link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Share cancelled.");
        return;
      }
      try {
        await copyDealLink(url);
        setStatus("Sharing was unavailable, so the deal link was copied.");
      } catch {
        setStatus("Sharing is unavailable on this device.");
      }
    }
  }

  const cardContent = (
    <>
      <div className="club-deal-copy">
        <span className="eyebrow">{`${dealTypeLabel(activeDeal.offerType)} · Club Deal`}</span>
        <h2>{activeDeal.dealTitle}</h2>
        {displayDescription && !compact ? <p>{displayDescription}</p> : null}
        {displayTerms && !compact ? <small>{displayTerms}</small> : null}
        {!compact ? <small>Availability is verified when you tap at the cashier.</small> : null}
        {dancerNote ? (
          <small>Dancer credit is carried securely to the cashier tap while this dancer remains verified at the club.</small>
        ) : null}
      </div>
      <div className="club-deal-action">
        <button
          className={`club-deal-checkout-action${intentState === "ready" ? " is-ready" : ""}`}
          type="button"
          data-club-deal-state={intentState === "ready" ? "ready" : "checkout"}
          onClick={selectForNfcTap}
          disabled={intentState === "ready"}
          aria-pressed={intentState === "ready"}
        >
          {intentState === "ready" ? "Ready at Cashier ✓" : intentState === "expired" || intentState === "error" ? "Try again" : actionLabel}
        </button>
      </div>
    </>
  );

  const validityLabel = dealAvailabilityLabel(activeDeal);
  const dialogContent = intentState === "ready" ? (
    <>
      <header className="club-deal-ready-header">
        <span className="club-deal-ready-kicker" role="status">Ready at Cashier ✓</span>
        <h2>{activeDeal.dealTitle}</h2>
        <p>{venueName || "Club"}</p>
      </header>
      <div className="club-deal-ready-instructions">
        <div className="club-deal-nfc-symbol" aria-label="Tap cashier sticker"><NfcIcon /></div>
        <div>
          <strong>Unlock your phone and tap the MyDancr cashier sticker.</strong>
          <p>You can close MyDancr now.</p>
        </div>
      </div>
      <p className="club-deal-security-note">Only this venue’s registered cashier sticker can complete redemption.</p>
      {intentExpiresAt ? <p className="club-deal-ready-until">Ready until {formatNfcExpiry(intentExpiresAt)}</p> : null}
      <div className="club-deal-primary-dock">
        <button
          className="club-deal-checkout-action is-ready"
          type="button"
          data-club-deal-state="ready"
          disabled
          aria-pressed="true"
        >
          Ready at Cashier ✓
        </button>
      </div>
    </>
  ) : (
    <>
      <header className="club-deal-dialog-header">
        <span className="eyebrow">Use at the cashier</span>
        <h2>{activeDeal.dealTitle}</h2>
        <p>{[venueName || "Club", dealTypeLabel(activeDeal.offerType)].filter(Boolean).join(" · ")}</p>
        <span className="club-deal-availability-status" role="status">Available now</span>
      </header>
      {displayDescription ? <p className="club-deal-benefit">{displayDescription}</p> : null}
      {validityLabel || displayTerms ? (
        <div className="club-deal-details">
          {validityLabel ? <p className="club-deal-validity">{validityLabel}</p> : null}
          {displayTerms ? (
            <>
              <button
                type="button"
                className="club-deal-terms-toggle"
                aria-expanded={termsExpanded}
                aria-controls={termsId}
                onClick={() => setTermsExpanded((expanded) => !expanded)}
              >
                {termsExpanded ? "Hide terms" : "View terms"}
              </button>
              <p className="club-deal-terms" id={termsId} hidden={!termsExpanded}>{displayTerms}</p>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="club-deal-redemption-guide">
        <div className="club-deal-nfc-symbol" aria-label="Tap cashier sticker"><NfcIcon /></div>
        <div className="club-deal-redemption-steps" aria-label="How to redeem">
          <div><span>1</span><strong>Tap &ldquo;Use this deal&rdquo;</strong></div>
          <div><span>2</span><strong>Go to cashier</strong></div>
          <div><span>3</span><strong>Unlock your phone &amp; tap the MyDancr cashier sticker</strong></div>
          <div><span>4</span><strong>Done</strong></div>
        </div>
      </div>
      <div className="club-deal-preview-note">
        <strong>After selecting, you can close MyDancr.</strong>
        <span>Only this venue’s registered cashier sticker can complete redemption.</span>
      </div>
      {status ? <em className={`deal-nfc-status ${intentState}`} role="status" aria-live="polite">{status}</em> : null}
      <div className="club-deal-share-actions">
        <button
          type="button"
          className={savedOnDevice ? "saved" : ""}
          aria-pressed={savedOnDevice}
          disabled={savePending}
          onClick={() => void (savedOnDevice ? removeSavedDeal() : saveForLater())}
        >
          {savePending ? "Updating…" : savedOnDevice ? "Saved ✓ · Remove" : "Save"}
        </button>
        <button type="button" onClick={() => void shareDeal()}>Share</button>
      </div>
      <div className="club-deal-primary-dock">
        <button
          className="club-deal-checkout-action"
          type="button"
          data-club-deal-state="checkout"
          onClick={selectForNfcTap}
          aria-pressed="false"
        >
          {intentState === "expired" ? "Use this deal again" : intentState === "error" ? "Try again" : "Use this deal"}
        </button>
      </div>
    </>
  );

  return (
    <>
      {presentation === "profileCompact" ? (
        <div className="club-deal-profile-compact" data-club-deal-state="available">
          <span className="club-deal-profile-copy">
            <strong>{activeDeal.dealTitle}</strong>
            <small>Active Club Deal</small>
          </span>
          <button
            aria-label={`${actionLabel} for ${activeDeal.dealTitle}`}
            className="club-deal-profile-action club-deal-active-action"
            data-club-deal-state="available"
            onClick={(event) => {
              openDealDialog(event.currentTarget);
            }}
            type="button"
          >
            <span>{actionLabel}</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      ) : presentation === "launcher" ? (
        <button
          className="club-deal-launcher club-deal-active-action"
          type="button"
          data-club-deal-state="available"
          onClick={(event) => {
            openDealDialog(event.currentTarget);
          }}
        >
          <span className="club-deal-launcher-copy">
            <small>Active Club Deal</small>
            <strong>{activeDeal.dealTitle}</strong>
            {contextLabel ? <em className="club-deal-launcher-context">{contextLabel}</em> : null}
          </span>
          <strong className="club-deal-launcher-action">{actionLabel}</strong>
        </button>
      ) : (
        <article
          className={`club-deal-card${compact ? " compact" : ""}`}
          id={sectionId}
        >
          {cardContent}
        </article>
      )}

      {stickyCta ? (
        <button
          className="club-deal-sticky club-deal-active-action"
          type="button"
          data-club-deal-state="available"
          onClick={(event) => {
            openDealDialog(event.currentTarget);
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
            data-deal-state={intentState}
            ref={dialogRef}
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
            {offerDeals.length > 1 && intentState !== "ready" ? (
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
                      }}
                    >
                      <span>{dealTypeLabel(offer.offerType)}</span>
                      <strong>{offer.dealTitle}</strong>
                      <small>{customerFacingDealDescription(offer.dealDescription) || "Club offer"}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {dialogContent}
          </section>
        </div>
      ) : null}

      <ClubDealInteractionStyles />
    </>
  );
}

function dealTypeLabel(value: ClubDeal["offerType"]) {
  if (value === "other") return "Club offer";
  return "Admission offer";
}

type PendingDealSelection = {
  venueId: string;
  dealId: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
  savedAt: number;
  expiresAt: number;
  expired: boolean;
};

type SavedDealEntry = Record<string, unknown> & { id: string };

function readPendingDealSelection(input: {
  venueId: string;
  dealId: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
}): PendingDealSelection | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEAL_INTENT_KEY) || "null") as Partial<PendingDealSelection> | null;
    if (!value || value.venueId !== input.venueId || value.dealId !== input.dealId) return null;
    if ((value.sourceType || "club_page") !== input.sourceType) return null;
    if (input.sourceType === "dancer_profile" && String(value.dancerId || "") !== String(input.dancerId || "")) return null;
    const savedAt = Number(value.savedAt || 0);
    const expiresAt = Number(value.expiresAt || savedAt + DEAL_INTENT_TTL_MS);
    return {
      venueId: input.venueId,
      dealId: input.dealId,
      sourceType: input.sourceType,
      dancerId: value.dancerId || null,
      savedAt,
      expiresAt,
      expired: !savedAt || expiresAt <= Date.now(),
    };
  } catch {
    return null;
  }
}

function savedDealId(venueId: string, dealId: string) {
  return `nfc:${venueId}:${dealId}`;
}

function readSavedDeals(): SavedDealEntry[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SAVED_DEALS_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedDealEntry => Boolean(
      item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string",
    ));
  } catch {
    return [];
  }
}

function isDealSavedOnDevice(venueId: string, dealId: string) {
  const id = savedDealId(venueId, dealId);
  return readSavedDeals().some((item) => item.id === id);
}

async function copyDealLink(url: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy unavailable");
}

function formatNfcExpiry(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dealAvailabilityLabel(deal: ClubDeal) {
  const days = Array.isArray(deal.validDays)
    ? deal.validDays.map((day) => String(day || "").slice(0, 3)).filter(Boolean).join(", ")
    : "";
  const start = formatDealClockTime(deal.validStartTime);
  const end = formatDealClockTime(deal.validEndTime);
  if (days && start && end) return `${days} · ${start}–${end}`;
  if (days && start) return `${days} · From ${start}`;
  if (days && end) return `${days} · Until ${end}`;
  if (days) return days;
  if (start && end) return `${start}–${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return "";
}

function formatDealClockTime(value: string | null) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, hours, minutes));
}

function ClubDealInteractionStyles() {
  return (
    <style>{`
      .club-deal-launcher { width: fit-content; max-width: 100%; min-height: 52px; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 8px; justify-items: stretch; padding: 7px 8px 7px 11px; border: 1px solid var(--dancr-color-success-medium); border-radius: 13px; color: #fff; background: color-mix(in srgb, var(--dancr-color-success) 14%, var(--dancr-color-surface)); box-shadow: 0 8px 18px var(--dancr-color-black-soft); font: inherit; text-align: left; cursor: pointer; }
      .club-deal-launcher-copy { min-width: 0; display: grid; gap: 3px; color: inherit; text-transform: none; }
      .club-deal-launcher-copy small { overflow: hidden; color: #b7ffd8; font-size: 9px; font-weight: 900; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-launcher-copy strong { max-width: 100%; overflow: hidden; color: #fff; font-size: 14px; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-launcher-copy em { color: #d8f7ff; font-size: 9px; font-style: normal; font-weight: 800; line-height: 1.15; }
      .club-deal-launcher-action { max-width: 116px; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; overflow: hidden; border-radius: 9px; color: #062015; background: #b7ffd8; font-size: 11px; line-height: 1.1; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-profile-compact { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) minmax(92px,auto); align-items: center; gap: 8px; }
      .club-deal-profile-copy { min-width: 0; display: flex; align-items: baseline; gap: 7px; overflow: hidden; }
      .club-deal-profile-copy strong { overflow: hidden; color: #fff; font-size: 14px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
      .club-deal-profile-copy small { flex: 0 0 auto; color: #4dec9d; font-size: 8px; font-weight: 900; letter-spacing: .08em; line-height: 1; text-transform: uppercase; white-space: nowrap; }
      .club-deal-profile-action { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 8px; border: 1px solid rgba(77,236,157,.28); border-radius: 10px; color: #eafff4; background: rgba(77,236,157,.07); font: inherit; font-size: 10px; font-weight: 900; cursor: pointer; }
      .club-deal-dialog-backdrop { position: fixed; z-index: 1700; inset: 0; display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); background: rgba(2,3,6,.86); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
      .club-deal-dialog { position: relative; width: min(400px, 100%); min-height:0; max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; overflow-x:hidden; overflow-y: auto; overscroll-behavior:contain; box-sizing: border-box; padding: 18px 16px 16px; border: 1px solid rgba(255,255,255,.14); border-radius: 22px; color: #f7f2ff; background: linear-gradient(145deg,rgba(17,18,22,.96),rgba(5,6,8,.985)); box-shadow: 0 28px 80px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.06); }
      .club-deal-dialog>* { flex:0 0 auto; }
      .club-deal-dialog-close { position: absolute; z-index: 2; top: 10px; right: 10px; width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; color: rgba(255,255,255,.82); background: rgba(26,27,32,.84); font: inherit; font-size: 23px; cursor: pointer; }
      .club-deal-dialog-header,.club-deal-ready-header { min-width:0; display:grid; justify-items:start; gap:4px; padding-right:40px; text-align:left; }
      .club-deal-dialog-header .eyebrow { color:#35d8ff; font-size:10px; font-weight:950; letter-spacing:.16em; text-transform:uppercase; }
      .club-deal-dialog-header h2,.club-deal-ready-header h2 { max-width:100%; margin:0; color:#fff; font-size:clamp(22px,6vw,29px); line-height:1.08; overflow-wrap:anywhere; text-wrap:balance; }
      .club-deal-dialog-header p,.club-deal-ready-header p { max-width:100%; margin:0; color:rgba(248,248,252,.76); font-size:12px; font-weight:800; line-height:1.3; overflow-wrap:anywhere; }
      .club-deal-availability-status { width:fit-content; min-height:24px; display:inline-flex; align-items:center; margin-top:3px; padding:0 9px; border:1px solid rgba(126,234,255,.3); border-radius:999px; color:#d9f9ff; background:rgba(53,216,255,.07); font-size:9px; font-weight:950; letter-spacing:.05em; text-transform:uppercase; }
      .club-deal-benefit { margin:0; padding:10px 11px; border:1px solid rgba(255,255,255,.1); border-radius:13px; color:rgba(255,255,255,.92); background:rgba(255,255,255,.035); font-size:13px; font-weight:850; line-height:1.35; overflow-wrap:anywhere; }
      .club-deal-details { display:grid; justify-items:start; gap:5px; }
      .club-deal-validity { margin:0; color:rgba(255,255,255,.7); font-size:10px; font-weight:800; line-height:1.3; }
      .club-deal-terms-toggle { width:fit-content; min-width:0; min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:0 13px; border:1px solid rgba(126,234,255,.22); border-radius:999px; color:#d9f9ff; background:rgba(53,216,255,.06); -webkit-appearance:none; appearance:none; font:inherit; font-size:12px; font-weight:900; line-height:1; text-decoration:none; white-space:nowrap; cursor:pointer; }
      .club-deal-terms-toggle::after { content:"⌄"; display:inline-block; color:#7eeaff; font-size:15px; line-height:1; transform:translateY(-1px); transition:transform 160ms ease; }
      .club-deal-terms-toggle[aria-expanded="true"]::after { transform:rotate(180deg) translateY(1px); }
      .club-deal-terms-toggle:focus-visible { outline:2px solid #c4b5fd; outline-offset:3px; }
      .club-deal-terms { width:100%; margin:0; padding:10px 11px; box-sizing:border-box; border:1px solid rgba(255,255,255,.08); border-radius:10px; color:rgba(255,255,255,.76); background:rgba(0,0,0,.22); font-size:12px; line-height:1.42; overflow-wrap:anywhere; }
      .club-deal-terms[hidden] { display:none; }
      .club-deal-redemption-guide { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:stretch; gap:8px; }
      .club-deal-nfc-symbol { width:56px; height:56px; display:grid; place-items:center; align-self:center; padding:5px; box-sizing:border-box; border:1px solid rgba(255,255,255,.14); border-radius:14px; color:#f8fdff; background:radial-gradient(circle at 45% 35%,rgba(133,76,255,.18),transparent 56%),rgba(9,9,13,.92); box-shadow:0 10px 22px rgba(0,0,0,.3); }
      .club-deal-nfc-symbol svg { width:42px; height:42px; display:block; place-self:center; padding:8px; box-sizing:border-box; border:1px solid rgba(126,234,255,.72); border-radius:50%; color:#f8fdff; background:radial-gradient(circle at 50% 44%,rgba(53,216,255,.14),transparent 66%),rgba(7,10,15,.88); box-shadow:0 0 0 1px rgba(255,255,255,.035),0 0 14px rgba(53,216,255,.3),inset 0 1px 0 rgba(255,255,255,.14); filter:drop-shadow(0 0 5px rgba(126,234,255,.3)); }
      .club-deal-redemption-steps { min-width:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
      .club-deal-redemption-steps>div { min-width:0; min-height:44px; display:grid; grid-template-columns:22px minmax(0,1fr); align-items:center; gap:7px; box-sizing:border-box; padding:7px 8px; border:1px solid rgba(255,255,255,.09); border-radius:10px; color:rgba(255,255,255,.9); background:rgba(255,255,255,.03); font-size:11.5px; line-height:1.24; text-align:left; }
      .club-deal-redemption-steps span { width:22px; height:22px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.16); border-radius:50%; color:#fff; font-size:10px; font-weight:900; }
      .club-deal-redemption-steps strong { min-width:0; font-weight:850; overflow-wrap:anywhere; }
      .club-deal-preview-note { display:grid; gap:2px; margin:0; color:#d9f9ff; font-size:10.5px; line-height:1.35; text-align:center; }
      .club-deal-preview-note strong { font-weight:950; }
      .club-deal-preview-note span { color:rgba(217,249,255,.72); font-weight:800; }
      .club-deal-primary-dock { position:static; z-index:1702; width:100%; display:grid; box-sizing:border-box; margin-top:0; padding:0; border:0; background:transparent; }
      .club-deal-dialog .club-deal-checkout-action { min-height:50px !important; border:1px solid rgba(167,139,250,.92) !important; border-radius:15px !important; color:#fff !important; background:linear-gradient(135deg,#5b21b6 0%,#7c3aed 52%,#8b5cf6 100%) !important; box-shadow:0 12px 28px rgba(0,0,0,.3),0 0 24px rgba(124,58,237,.38),inset 0 1px 0 rgba(255,255,255,.22) !important; -webkit-appearance:none; appearance:none; font:inherit; font-weight:950 !important; cursor:pointer; transition:filter 160ms ease,transform 160ms ease,box-shadow 160ms ease !important; }
      @media (hover:hover) and (pointer:fine) {
        .club-deal-dialog .club-deal-checkout-action:hover:not(:disabled) { filter:brightness(1.08); box-shadow:0 16px 34px rgba(0,0,0,.34),0 0 32px rgba(124,58,237,.52),inset 0 1px 0 rgba(255,255,255,.26) !important; }
      }
      .club-deal-dialog .club-deal-checkout-action:active:not(:disabled) { transform:translateY(1px); filter:brightness(.96); box-shadow:0 9px 22px rgba(0,0,0,.34),0 0 18px rgba(124,58,237,.36),inset 0 2px 7px rgba(0,0,0,.22) !important; }
      .club-deal-dialog .club-deal-checkout-action:focus-visible { outline:2px solid #c4b5fd !important; outline-offset:3px !important; }
      .club-deal-dialog .club-deal-checkout-action.is-ready:disabled { opacity:1 !important; filter:none !important; color:#fff !important; border-color:rgba(74,222,128,.88) !important; background:linear-gradient(135deg,#087443 0%,#0f9f5b 58%,#16a34a 100%) !important; box-shadow:0 12px 28px rgba(0,0,0,.3),0 0 24px rgba(34,197,94,.34),inset 0 1px 0 rgba(255,255,255,.2) !important; cursor:default !important; }
      @supports (-webkit-touch-callout:none) {
        .club-deal-dialog .club-deal-checkout-action:not(.is-ready) { border-color:rgba(112,72,224,.88) !important; background:#32009c !important; box-shadow:0 14px 32px rgba(0,0,0,.32),0 0 18px rgba(60,12,158,.3),inset 0 1px 0 rgba(255,255,255,.14) !important; filter:none !important; }
      }
      .club-deal-dialog .deal-nfc-status { padding:7px 9px; border:1px solid rgba(255,255,255,.08); border-radius:10px; color:rgba(245,245,255,.76); background:rgba(0,0,0,.22); font-size:10px; font-style:normal; line-height:1.3; text-align:center; }
      .club-deal-dialog .deal-nfc-status.error,.club-deal-dialog .deal-nfc-status.expired { border-color:rgba(255,157,174,.28); color:#ffd5dd; background:rgba(255,99,132,.07); }
      .club-deal-ready-kicker { color:#4dec9d; font-size:12px; font-weight:950; letter-spacing:.12em; text-transform:uppercase; }
      .club-deal-ready-instructions { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:center; gap:11px; padding:10px; border:1px solid rgba(74,222,128,.28); border-radius:13px; background:rgba(34,197,94,.07); text-align:left; }
      .club-deal-ready-instructions strong { color:#effff6; font-size:13px; line-height:1.3; }
      .club-deal-ready-instructions p { margin:4px 0 0; color:#b7ffd1; font-size:10px; font-weight:850; }
      .club-deal-security-note,.club-deal-ready-until { margin:0; color:#d9f9ff; font-size:10px; font-weight:850; line-height:1.35; text-align:center; }
      .club-deal-ready-until { color:rgba(255,255,255,.62); }
      .club-deal-share-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .club-deal-share-actions button { min-height:36px; border:1px solid rgba(255,255,255,.12); border-radius:11px; color:rgba(255,255,255,.82); background:rgba(255,255,255,.035); font:inherit; font-size:11px; font-weight:900; cursor:pointer; }
      .club-deal-share-actions button.saved { color:#d9f9ff; border-color:rgba(126,234,255,.26); background:rgba(53,216,255,.07); }
      .club-deal-share-actions button:disabled { cursor:default; opacity:.82; }
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
        .club-deal-dialog-backdrop { padding:max(8px,env(safe-area-inset-top)) 8px max(8px,env(safe-area-inset-bottom)); }
        .club-deal-dialog { width:min(380px,100%); max-height:calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); gap:6px; padding:14px 12px max(14px,env(safe-area-inset-bottom)); border-radius:20px; }
        .club-deal-dialog-close { top:8px; right:8px; width:32px; height:32px; font-size:20px; }
        .club-deal-dialog-header h2,.club-deal-ready-header h2 { font-size:clamp(20px,5.7vw,25px); }
        .club-deal-benefit { padding:9px 10px; font-size:13px; line-height:1.35; }
        .club-deal-redemption-guide { grid-template-columns:52px minmax(0,1fr); gap:6px; }
        .club-deal-nfc-symbol { width:52px; height:52px; }
        .club-deal-nfc-symbol svg { width:38px; height:38px; padding:7px; }
        .club-deal-redemption-steps { gap:5px; }
        .club-deal-redemption-steps>div { grid-template-columns:21px minmax(0,1fr); gap:6px; padding:6px 7px; font-size:11px; line-height:1.24; }
        .club-deal-redemption-steps span { width:21px; height:21px; font-size:9px; }
        .club-deal-preview-note { font-size:10px; line-height:1.32; }
        .club-deal-share-actions { gap:6px; }
        .club-deal-share-actions button { min-height:34px; font-size:10px; }
        .club-deal-dialog .club-deal-checkout-action { min-height:46px !important; }
        .club-deal-sticky { position: fixed; z-index: 95; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border: 1px solid var(--dancr-color-success-medium); border-radius: 16px; color: #fff; background: var(--dancr-color-surface-translucent); box-shadow: 0 18px 50px rgba(0,0,0,.68); font: inherit; text-align: left; cursor: pointer; }
        .club-deal-sticky span { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
        .club-deal-sticky strong { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 12px; color: #061015; background: #7eeaff; font-size: 13px; font-weight: 950; white-space: nowrap; }
      }
      @media (max-width: 330px) {
        .club-deal-dialog { width:100%; }
        .club-deal-redemption-guide { grid-template-columns:46px minmax(0,1fr); }
        .club-deal-nfc-symbol { width:46px; height:46px; }
        .club-deal-nfc-symbol svg { width:34px; height:34px; }
        .club-deal-redemption-steps { grid-template-columns:1fr; }
      }
    `}</style>
  );
}
