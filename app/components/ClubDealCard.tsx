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
import { deviceSavedDealsStorageKey, DEVICE_SAVED_DEALS_CHANGED_EVENT } from "@/src/lib/dancr/customer-device-deals";

const DEAL_INTENT_KEY = "mydancrPendingNfcDealV2";
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
  const saveStateVersion = useRef(0);
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
  const useLabel = activeDeal.dealTitle.toLowerCase() === "free admission" ? "Use free admission" : "Use this deal";
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
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const version = ++saveStateVersion.current;
      const storageKey = currentSavedDealsStorageKey();
      setSavedOnDevice(isDealSavedOnDevice(venueId, activeDeal.id));
      void loadCustomerDealSavedState(activeDeal.id, signal)
        .then((saved) => {
          if (!signal.aborted && version === saveStateVersion.current && storageKey === currentSavedDealsStorageKey() && typeof saved === "boolean") {
            setSavedOnDevice(saved || isDealSavedOnDevice(venueId, activeDeal.id));
          }
        })
        .catch(() => {
          // Keep the device copy usable if private account state cannot load.
        });
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(DEVICE_SAVED_DEALS_CHANGED_EVENT, refresh);
    return () => {
      controller.abort();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(DEVICE_SAVED_DEALS_CHANGED_EVENT, refresh);
    };
  }, [activeDeal.id, venueId]);

  useEffect(() => {
    setTermsExpanded(false);
  }, [activeDeal.id, dialogOpen]);

  useEffect(() => {
    if (dialogOpen && intentState === "ready") {
      dialogRef.current?.querySelector<HTMLElement>(".club-deal-ready-header")?.focus({ preventScroll: true });
    }
  }, [dialogOpen, intentState]);

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
    saveStateVersion.current += 1;
    setSavePending(true);
    const hasCustomerAccount = hasSignedInCustomerDealAccount();
    const storageKey = currentSavedDealsStorageKey();
    try {
      let savedToAccount = false;
      if (hasCustomerAccount) {
        try {
          savedToAccount = await setCustomerDealSavedInAccount({
            dealId: activeDeal.id,
            saved: true,
            sourceType,
            dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
          }) === true;
        } catch {
          // Keep saving available on this device when private account storage is temporarily unavailable.
        }
      }
      if (storageKey !== currentSavedDealsStorageKey()) return;
      let savedOnThisDevice = false;
      try {
        if (!storageKey) throw new Error("Account storage unavailable");
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
        const next = savedToAccount
          ? saved.filter((item) => item.id !== id)
          : [deviceDeal, ...saved.filter((item) => item.id !== id)].slice(0, 20);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        savedOnThisDevice = true;
      } catch {
        // The private account remains the source of truth when device storage is blocked.
      }
      if (!savedToAccount && !savedOnThisDevice) {
        setSavedOnDevice(false);
        setStatus("Browser storage blocked saving this deal. Allow site storage and try again.");
        return;
      }
      setSavedOnDevice(true);
      setStatus(savedToAccount
        ? "Saved to your account. Find it in Saved Club Deals beside the bell on Home."
        : hasCustomerAccount
          ? "Saved on this device. Find it in Saved Club Deals beside the bell on Home."
          : "Saved in this browser. Sign in before saving deals to your account.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save this Club Deal.");
    } finally {
      setSavePending(false);
    }
  }

  async function removeSavedDeal() {
    if (savePending) return;
    saveStateVersion.current += 1;
    setSavePending(true);
    const hasCustomerAccount = hasSignedInCustomerDealAccount();
    const storageKey = currentSavedDealsStorageKey();
    try {
      let removedFromAccount = false;
      if (hasCustomerAccount) {
        try {
          removedFromAccount = await setCustomerDealSavedInAccount({
            dealId: activeDeal.id,
            saved: false,
            sourceType,
            dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
          }) === true;
        } catch {
          // Keep removal available on this device when private account storage is temporarily unavailable.
        }
      }
      if (storageKey !== currentSavedDealsStorageKey()) return;
      let removedFromDevice = false;
      try {
        if (!storageKey) throw new Error("Account storage unavailable");
        const id = savedDealId(venueId, activeDeal.id);
        const next = readSavedDeals().filter((item) => item.id !== id);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        removedFromDevice = true;
      } catch {
        // The private account remains the source of truth when device storage is blocked.
      }
      if (!removedFromAccount && !removedFromDevice) {
        setSavedOnDevice(true);
        setStatus("Browser storage blocked removing this deal. Allow site storage and try again.");
        return;
      }
      setSavedOnDevice(false);
      setStatus(removedFromAccount
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
          onClick={(event) => openDealDialog(event.currentTarget)}
        >
          {intentState === "ready" ? "Ready for your cashier tap" : actionLabel}
        </button>
      </div>
    </>
  );

  const validityLabel = dealAvailabilityLabel(activeDeal);
  const dialogContent = intentState === "ready" ? (
    <>
      <header className="club-deal-ready-header" role="status" tabIndex={-1}>
        <h2>Ready for your cashier tap</h2>
        <p>{activeDeal.dealTitle} · {venueName || "Club"}</p>
      </header>
      <div className="club-deal-ready-content">
        <div className="club-deal-ready-instructions">
          <div className="club-deal-nfc-symbol" aria-hidden="true"><NfcIcon /></div>
          <p>When you reach the cashier, unlock your phone and hold it near the MyDancr sticker.</p>
        </div>
        <div className="club-deal-ready-footer">
          <p className="club-deal-ready-close-note">You can close MyDancr now.</p>
          {intentExpiresAt ? <p className="club-deal-ready-until">Ready until {formatNfcExpiry(intentExpiresAt)}</p> : null}
        </div>
      </div>
    </>
  ) : (
    <>
      <header className="club-deal-dialog-header">
        <h2>{activeDeal.dealTitle}</h2>
        <p>Valid at {venueName || "this club"}</p>
      </header>
      <div className="club-deal-preview-content">
        {validityLabel ? <p className="club-deal-validity">{validityLabel}</p> : null}
        <div className="club-deal-preview-panel">
          <div className="club-deal-nfc-symbol" aria-hidden="true"><NfcIcon /></div>
          <p className="club-deal-preview-instruction">Tap &ldquo;{intentState === "error" ? "Try again" : useLabel}&rdquo;, then go to the cashier.</p>
          {status ? <em className={`deal-nfc-status ${intentState}`} role="status" aria-live="polite">{status}</em> : null}
          {displayDescription || displayTerms ? (
            <div className="club-deal-details">
              <button
                type="button"
                className="club-deal-terms-toggle"
                aria-expanded={termsExpanded}
                aria-controls={termsId}
                onClick={() => setTermsExpanded((expanded) => !expanded)}
              >
                {termsExpanded ? "Hide terms" : "Terms"}
              </button>
              <div className="club-deal-terms" id={termsId} hidden={!termsExpanded}>
                {displayDescription ? <p>{displayDescription}</p> : null}
                {displayTerms ? <p>{displayTerms}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="club-deal-primary-dock">
        <div className="club-deal-share-actions">
          <button
            type="button"
            className={savedOnDevice ? "saved" : ""}
            aria-pressed={savedOnDevice}
            aria-busy={savePending}
            aria-live="polite"
            title={savedOnDevice ? "Remove saved deal" : "Save this deal"}
            disabled={savePending}
            onClick={() => void (savedOnDevice ? removeSavedDeal() : saveForLater())}
          >
            {savePending ? (savedOnDevice ? "Removing…" : "Saving…") : savedOnDevice ? "Saved ✓" : "Save"}
          </button>
          <button type="button" onClick={() => void shareDeal()}>Share</button>
        </div>
        <button
          className="club-deal-checkout-action"
          type="button"
          data-club-deal-state="checkout"
          onClick={selectForNfcTap}
          aria-pressed="false"
        >
          {intentState === "error" ? "Try again" : useLabel}
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

function currentSavedDealsStorageKey() {
  try {
    return deviceSavedDealsStorageKey(window.localStorage);
  } catch {
    return null;
  }
}

function readSavedDeals(): SavedDealEntry[] {
  try {
    const storageKey = currentSavedDealsStorageKey();
    if (!storageKey) return [];
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
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
      .club-deal-dialog { position: relative; width: min(400px, 100%); height:300px; min-height:0; max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; box-sizing:border-box; padding:22px; border:1px solid rgba(199,181,244,.18); border-radius:24px; color:#f5f2fa; background:radial-gradient(ellipse at 0 0,rgba(123,91,178,.1),transparent 65%),linear-gradient(155deg,#15141b,#0c0c11 75%); box-shadow:0 24px 72px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.045); font-family:var(--font-ui); }
      .club-deal-dialog>* { flex:0 0 auto; }
      .club-deal-dialog:has(.club-deal-terms-toggle[aria-expanded="true"]),.club-deal-dialog:has(.club-deal-offer-picker) { height:auto; min-height:min(300px,calc(100dvh - 32px)); }
      .club-deal-dialog-close { position:absolute; z-index:2; top:10px; right:10px; width:44px; height:44px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; color:#aaa4b6; background:transparent; font:inherit; font-size:23px; cursor:pointer; }
      .club-deal-dialog-close:hover { color:#fff; background:rgba(255,255,255,.05); }
      .club-deal-dialog button:focus-visible { outline:2px solid #c4b5fd !important; outline-offset:3px !important; }
      .club-deal-dialog-header,.club-deal-ready-header { min-width:0; display:grid; justify-items:start; gap:6px; text-align:left; }
      .club-deal-dialog-header h2,.club-deal-ready-header h2 { max-width:100%; margin:0; padding-right:34px; color:#f7f4fc; font-family:var(--font-ui); font-size:clamp(23px,6vw,26px); font-weight:650; letter-spacing:-.035em; line-height:1.16; overflow-wrap:anywhere; text-wrap:balance; }
      .club-deal-dialog-header p,.club-deal-ready-header p { max-width:100%; margin:0; color:#a9a3b6; font-size:13px; font-weight:450; line-height:1.4; overflow-wrap:anywhere; }
      .club-deal-preview-content { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:10px; }
      .club-deal-preview-content>* { flex:0 0 auto; }
      .club-deal-preview-panel { flex:1 0 auto; display:grid; grid-template-columns:40px minmax(0,1fr) auto; align-items:center; gap:10px; padding:8px 10px; border:1px solid rgba(183,155,225,.16); border-radius:18px; background:linear-gradient(130deg,rgba(143,107,199,.1),rgba(143,107,199,.025)); }
      .club-deal-details { display:contents; }
      .club-deal-validity { margin:0; color:#aaa3b9; font-size:12px; font-weight:450; line-height:1.4; }
      .club-deal-preview-instruction { margin:0; color:#e5deef; font-size:14px; font-weight:500; line-height:1.45; }
      .club-deal-preview-panel:has(.deal-nfc-status) .club-deal-preview-instruction { display:none; }
      .club-deal-dialog .club-deal-preview-panel .deal-nfc-status { grid-column:2; grid-row:1; margin:0; padding:0; border:0; color:#e5deef; background:none; font-size:14px; font-weight:500; line-height:1.45; }
      .club-deal-dialog .club-deal-preview-panel .deal-nfc-status.error,.club-deal-dialog .club-deal-preview-panel .deal-nfc-status.expired { color:#ffd5dd; }
      .club-deal-terms-toggle { grid-column:3; width:fit-content; min-width:44px; min-height:44px; margin:0; padding:0; border:0 !important; border-radius:0 !important; color:#c5b5df !important; background:transparent !important; box-shadow:none !important; -webkit-appearance:none; appearance:none; font:inherit; font-size:12px; font-weight:500; text-decoration:underline; text-decoration-color:rgba(185,172,210,.35); text-underline-offset:4px; cursor:pointer; }
      .club-deal-terms { grid-column:1 / -1; width:100%; margin:0; padding:12px; box-sizing:border-box; border:1px solid rgba(255,255,255,.08); border-radius:12px; color:#c7c0d3; background:rgba(255,255,255,.025); font-size:13px; font-weight:400; line-height:1.5; overflow-wrap:anywhere; }
      .club-deal-terms[hidden] { display:none; }
      .club-deal-terms p { margin:0; }
      .club-deal-terms p + p { margin-top:8px; }
      .club-deal-ready-content { flex:1 0 auto; display:flex; flex-direction:column; gap:12px; }
      .club-deal-ready-instructions { flex:1 0 auto; display:grid; grid-template-columns:64px minmax(0,1fr); align-items:center; gap:14px; padding:14px; border:1px solid rgba(183,155,225,.16); border-radius:18px; background:linear-gradient(130deg,rgba(143,107,199,.1),rgba(143,107,199,.025)); }
      .club-deal-ready-instructions p { margin:0; color:#e5deef; font-size:14px; font-weight:500; line-height:1.45; }
      .club-deal-ready-footer { display:grid; gap:4px; }
      .club-deal-ready-close-note { margin:0; color:#c5bbd5; font-size:12px; font-weight:450; line-height:1.5; }
      .club-deal-ready-until { margin:0; color:#aaa2b8; font-size:12px; font-weight:400; line-height:1.4; text-align:left; }
      .club-deal-nfc-symbol { width:64px; height:64px; display:grid; place-items:center; box-sizing:border-box; border:1px solid rgba(183,155,225,.28); border-radius:20px; color:#d6bdfb; background:radial-gradient(circle at 35% 25%,rgba(172,126,240,.2),rgba(143,107,199,.035)); box-shadow:inset 0 1px 0 rgba(255,255,255,.045); }
      .club-deal-nfc-symbol svg { width:36px; height:36px; display:block; place-self:center; }
      .club-deal-preview-panel .club-deal-nfc-symbol { width:40px; height:40px; border-radius:14px; }
      .club-deal-preview-panel .club-deal-nfc-symbol svg { width:24px; height:24px; }
      .club-deal-primary-dock { position:static; z-index:1702; width:100%; display:grid; gap:10px; box-sizing:border-box; margin-top:auto; padding:0; border:0; background:transparent; }
      .club-deal-dialog .club-deal-checkout-action { min-height:48px !important; padding:0 16px; border:1px solid rgba(188,154,249,.3) !important; border-radius:13px !important; color:#fff !important; background:linear-gradient(120deg,#7743cf,#6330bd) !important; box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 6px 18px rgba(68,28,130,.18) !important; -webkit-appearance:none; appearance:none; font:inherit; font-size:14px; font-weight:600 !important; letter-spacing:.01em; cursor:pointer; transition:filter 160ms ease,transform 160ms ease; }
      @media (hover:hover) and (pointer:fine) {
        .club-deal-dialog .club-deal-checkout-action:hover:not(:disabled) { filter:brightness(1.08); }
      }
      .club-deal-dialog .club-deal-checkout-action:active:not(:disabled) { transform:translateY(1px); filter:brightness(.96); }
      .club-deal-dialog .deal-nfc-status { margin:0; padding:8px 10px; border:1px solid rgba(255,255,255,.08); border-radius:10px; color:#c7c0d3; background:rgba(0,0,0,.22); font-size:12px; font-weight:450; font-style:normal; line-height:1.4; text-align:left; }
      .club-deal-dialog .deal-nfc-status.error,.club-deal-dialog .deal-nfc-status.expired { border-color:rgba(255,157,174,.28); color:#ffd5dd; background:rgba(255,99,132,.07); }
      .club-deal-share-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .club-deal-share-actions button { min-height:44px; padding:0 12px; border:1px solid rgba(211,198,237,.14); border-radius:12px; color:#dcd5e8; background:rgba(255,255,255,.025); font:inherit; font-size:13px; font-weight:550; cursor:pointer; }
      .club-deal-share-actions button.saved { color:#ddd0fa; border-color:rgba(172,138,226,.28); background:rgba(129,85,192,.12); }
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
        .club-deal-dialog { width:min(380px,100%); max-height:calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); gap:12px; padding:20px; border-radius:24px; }
        .club-deal-dialog-close { top:10px; right:10px; width:44px; height:44px; font-size:20px; }
        .club-deal-dialog-header h2,.club-deal-ready-header h2 { font-size:clamp(23px,6vw,26px); }
        .club-deal-share-actions { gap:10px; }
        .club-deal-share-actions button { min-height:44px; font-size:13px; }
        .club-deal-dialog .club-deal-checkout-action { min-height:48px !important; }
        .club-deal-sticky { position: fixed; z-index: 95; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); min-height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border: 1px solid var(--dancr-color-success-medium); border-radius: 16px; color: #fff; background: var(--dancr-color-surface-translucent); box-shadow: 0 18px 50px rgba(0,0,0,.68); font: inherit; text-align: left; cursor: pointer; }
        .club-deal-sticky span { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
        .club-deal-sticky strong { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 12px; color: #061015; background: #7eeaff; font-size: 13px; font-weight: 950; white-space: nowrap; }
      }
      @media (max-width: 330px) {
        .club-deal-dialog { width:100%; }
      }
      @media (max-width: 360px) {
        .club-deal-ready-instructions { grid-template-columns:48px minmax(0,1fr); gap:12px; padding:12px; }
        .club-deal-nfc-symbol { width:48px; height:48px; border-radius:16px; }
        .club-deal-nfc-symbol svg { width:28px; height:28px; }
      }
    `}</style>
  );
}
