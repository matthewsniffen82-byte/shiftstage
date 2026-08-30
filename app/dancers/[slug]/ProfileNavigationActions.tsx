"use client";

import { useEffect, useState } from "react";
import { recordPublicEngagementShare } from "@/src/lib/dancr/engagement-client";

export function ProfileCloseButton({
  fallbackHref,
  profileType = "dancer",
}: {
  fallbackHref: string;
  profileType?: "dancer" | "venue";
}) {
  function navigateToFallback() {
    const destination = new URL(fallbackHref, window.location.origin);
    window.location.assign(destination.toString());
  }

  function closeProfile() {
    const referrer = document.referrer;
    if (referrer) {
      try {
        const previousUrl = new URL(referrer);
        if (
          previousUrl.origin === window.location.origin &&
          previousUrl.href !== window.location.href &&
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
      aria-label={`Close full ${profileType} profile and return to the previous page or discovery results`}
      className="public-profile-close"
      onClick={closeProfile}
      type="button"
    >
      ×
    </button>
  );
}
export function ProfileShareButton({ dancerId, stageName }: { dancerId: string; stageName: string }) {
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

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

  async function shareProfile() {
    const url = profileUrl();
    setStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${stageName} on mydancr`,
          text: `View ${stageName}'s verified dancer profile on mydancr.`,
          url,
        });
        void recordPublicEngagementShare("profile", dancerId);
        setStatus("Profile shared.");
        return;
      }
      await navigator.clipboard.writeText(url);
      void recordPublicEngagementShare("profile", dancerId);
      setStatus("Profile link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Unable to share this profile.");
    }
  }

  async function copyProfileLink() {
    setStatus("");
    try {
      await navigator.clipboard.writeText(profileUrl());
      void recordPublicEngagementShare("profile", dancerId);
      setStatus("Profile link copied.");
    } catch {
      setStatus("Unable to copy this profile link.");
    }
  }

  return (
    <>
      <div className="profile-share">
        <button
          aria-haspopup="dialog"
          className="profile-action-icon-control profile-share-trigger"
          onClick={() => setDialogOpen(true)}
          type="button"
        >
          <span className="profile-action-main">
            <span aria-hidden="true" className="profile-action-icon-frame" data-profile-action-icon="share">
              <ShareIcon />
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
              aria-label="Close profile sharing"
              autoFocus
              className="profile-share-dialog-close"
              onClick={closeDialog}
              type="button"
            >
              ×
            </button>
            <span>Share profile</span>
            <h2 id="profile-share-dialog-title">{stageName} on MyDancr</h2>
            <p>
              Send the public profile directly or copy its secure link. Club
              Deal redemption happens only when you tap your phone at the club cashier.
            </p>

            <div className="profile-share-dialog-actions">
              <button className="primary" onClick={shareProfile} type="button">
                <ShareIcon />
                Share profile
              </button>
              <button onClick={copyProfileLink} type="button">
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

function ShareIcon() {
  return (
    <svg className="profile-action-preview-icon profile-action-preview-icon-share" aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  );
}
