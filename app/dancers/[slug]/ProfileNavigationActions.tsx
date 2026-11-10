"use client";

import { useEffect, useRef, useState } from "react";
import { recordPublicEngagementShare } from "@/src/lib/dancr/engagement-client";

export function ProfileCloseButton({
  fallbackHref,
  vipReturnHref = "",
  venueReturnHref = "",
  dancerReturnHref = "",
  profileType = "dancer",
  onClose,
}: {
  fallbackHref: string;
  vipReturnHref?: string;
  venueReturnHref?: string;
  dancerReturnHref?: string;
  profileType?: "dancer" | "venue";
  onClose?: () => void;
}) {
  function navigateToFallback() {
    if (dancerReturnHref) {
      window.location.replace(dancerReturnHref);
      return;
    }
    const destination = new URL(fallbackHref, window.location.origin);
    window.location.assign(destination.toString());
  }

  function closeProfile() {
    if (onClose) { onClose(); return; }
    // Dashboard links retain their destination even without browser history.
    if (vipReturnHref || venueReturnHref) {
      window.location.assign(new URL(vipReturnHref || venueReturnHref, window.location.origin).toString());
      return;
    }
    const referrer = document.referrer;
    if (referrer) {
      try {
        const previousUrl = new URL(referrer);
        if (
          previousUrl.origin === window.location.origin &&
          previousUrl.href !== window.location.href &&
          (!dancerReturnHref || previousUrl.pathname === new URL(dancerReturnHref, window.location.origin).pathname) &&
          window.history.length > 1
        ) {
          const fallbackTimer = window.setTimeout(navigateToFallback, 900);
          window.addEventListener(
            "pagehide",
            () => window.clearTimeout(fallbackTimer),
            { once: true },
          );
          window.history.back();
          return;
        }
      } catch {
        // Use the homepage fallback below.
      }
    }
    navigateToFallback();
  }

  return (
    <button
      data-close-control={profileType === "venue" ? "" : undefined} aria-label={dancerReturnHref ? "Back to dancer dashboard" : vipReturnHref ? "Back to VIP dashboard" : venueReturnHref ? "Back to club dashboard" : profileType === "dancer" ? "Back to previous page or dancer discovery results" : `Close full ${profileType} profile and return to the previous page or discovery results`}
      className="public-profile-close"
      onClick={closeProfile}
      type="button"
    >
      {profileType === "dancer" ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 5-7 7 7 7M5 12h14" />
        </svg>
      ) : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>}
    </button>
  );
}
export function ProfileShareButton({ dancerId, stageName, preview = false }: { dancerId: string; stageName: string; preview?: boolean }) {
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<{ command: "share" | "copy"; done: boolean } | null>(null);
  const inFlight = useRef(false);
  const busy = action !== null && !action.done;

  useEffect(() => {
    if (!action?.done) return;
    const timer = window.setTimeout(() => setAction(null), 1800);
    return () => window.clearTimeout(timer);
  }, [action]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialogOpen]);

  function profileUrl() {
    return new URL(window.location.pathname, window.location.origin).toString();
  }

  function closeDialog() {
    setDialogOpen(false);
    setStatus("");
  }

  async function shareProfile(command: "share" | "copy") {
    if (inFlight.current) return;
    inFlight.current = true;
    const useShareSheet = command === "share" && typeof navigator.share === "function";
    setAction({ command, done: false });
    setStatus("");
    try {
      const url = profileUrl();
      if (useShareSheet) {
        await navigator.share({
          title: `${stageName} on mydancr`,
          text: `View ${stageName}'s verified dancer profile on mydancr.`,
          url,
        });
        setStatus("Profile shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setStatus("Profile link copied.");
      }
      setAction({ command, done: true });
      void recordPublicEngagementShare("profile", dancerId);
    } catch (error) {
      setAction(null);
      if (!(error instanceof Error && error.name === "AbortError")) {
        setStatus(useShareSheet ? "Unable to share this profile." : "Unable to copy this profile link.");
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <div className="profile-share">
        <button
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          aria-busy={busy || undefined}
          aria-label={`Share ${stageName} profile`}
          className="profile-action-icon-control profile-share-trigger"
          aria-disabled={preview || undefined}
          onClick={() => { if (!preview) setDialogOpen(true); }}
          type="button"
        >
          <span className="profile-action-main">
            <span aria-hidden="true" className="profile-action-icon-frame" data-profile-action-icon="share">
              <ShareIcon state={action?.done ? "check" : dialogOpen ? "open" : "share"} />
            </span>
            <span>Share</span>
          </span>
        </button>
        <span aria-live="polite">{status}</span>
      </div>

      {dialogOpen ? (
        <div
          className="profile-share-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-labelledby="profile-share-dialog-title"
            aria-modal="true"
            className="profile-share-dialog"
            role="dialog"
          >
            <button
              data-close-control="" aria-label="Close profile sharing"
              autoFocus
              className="profile-share-dialog-close"
              onClick={closeDialog}
              type="button"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            <span>Share profile</span>
            <h2 id="profile-share-dialog-title">{stageName} on MyDancr</h2>
            <p>
              Send the public profile directly or copy its secure link.
              Club staff scans your admission pass and confirms entry at the door.
            </p>

            <div className="profile-share-dialog-actions">
              <button className="primary" disabled={busy} aria-busy={(busy && action?.command === "share") || undefined} onClick={() => void shareProfile("share")} type="button">
                <ShareIcon state={action?.command === "share" && action.done ? "check" : "share"} />
                Share profile
              </button>
              <button disabled={busy} aria-busy={(busy && action?.command === "copy") || undefined} onClick={() => void shareProfile("copy")} type="button">
                <ShareIcon state={action?.command === "copy" && action.done ? "check" : "copy"} />
                Copy profile link
              </button>
            </div>
            <span aria-live="polite" className="profile-share-dialog-status">
              {status}
            </span>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ShareIcon({ state = "share" }: { state?: "share" | "copy" | "check" | "open" }) {
  return (
    <svg className="profile-action-preview-icon profile-action-preview-icon-share" aria-hidden="true" viewBox="0 0 24 24">
      {state === "check" && <path d="m5 12 4 4L19 6" />}
      {state === "open" && <path d="m6 6 12 12M18 6 6 18" />}
      {state === "copy" && <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
      </>}
      {state === "share" && <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </>}
    </svg>
  );
}
