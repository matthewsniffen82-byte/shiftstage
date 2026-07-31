"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function ProfileCloseButton({
  fallbackHref,
  profileType = "dancer",
}: {
  fallbackHref: string;
  profileType?: "dancer" | "venue";
}) {
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
          window.history.back();
          return;
        }
      } catch {
        // Use the homepage fallback below.
      }
    }
    window.location.assign(fallbackHref);
  }

  return (
    <button
      aria-label={`Close full ${profileType} profile and return to the previous page`}
      className="public-profile-close"
      onClick={closeProfile}
      type="button"
    >
      ×
    </button>
  );
}

export function ProfileShareButton({ stageName }: { stageName: string }) {
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

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
    setQrVisible(false);
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
        setStatus("Profile shared.");
        return;
      }
      await navigator.clipboard.writeText(url);
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
      setStatus("Profile link copied.");
    } catch {
      setStatus("Unable to copy this profile link.");
    }
  }

  async function showProfileQr() {
    setStatus("");
    setQrVisible(true);
    if (qrDataUrl) return;
    try {
      const nextQrDataUrl = await QRCode.toDataURL(profileUrl(), {
        width: 520,
        margin: 2,
        color: { dark: "#050507", light: "#ffffff" },
      });
      setQrDataUrl(nextQrDataUrl);
    } catch {
      setStatus("Unable to generate the profile-sharing QR.");
    }
  }

  return (
    <>
      <div className="profile-share">
        <button
          aria-haspopup="dialog"
          onClick={() => setDialogOpen(true)}
          type="button"
        >
          <ShareIcon />
          Share profile
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
              Send this profile directly or let someone scan a profile-sharing
              QR. This is not a Club Deal and cannot be redeemed at a venue.
            </p>

            {qrVisible ? (
              <div className="profile-share-qr">
                <strong>Profile-sharing QR</strong>
                {qrDataUrl ? (
                  <img
                    alt={`Profile-sharing QR for ${stageName}`}
                    src={qrDataUrl}
                  />
                ) : (
                  <div aria-label="Generating profile-sharing QR" role="status">
                    Generating QR…
                  </div>
                )}
                <small>Scan to open this dancer profile.</small>
              </div>
            ) : null}

            <div className="profile-share-dialog-actions">
              <button className="primary" onClick={shareProfile} type="button">
                <ShareIcon />
                Share profile
              </button>
              <button onClick={showProfileQr} type="button">
                <QrIcon />
                {qrVisible ? "Refresh profile QR" : "Show profile-sharing QR"}
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
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="7" rx="1" width="7" x="3" y="3" />
      <rect height="7" rx="1" width="7" x="14" y="3" />
      <rect height="7" rx="1" width="7" x="3" y="14" />
      <path d="M14 14h3v3h-3zM19 14h2v5h-2M14 19h3v2h-3M19 21h2" />
    </svg>
  );
}
