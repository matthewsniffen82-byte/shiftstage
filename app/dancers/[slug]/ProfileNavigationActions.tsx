"use client";

import { useState } from "react";

export function ProfileCloseButton({ fallbackHref }: { fallbackHref: string }) {
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
      aria-label="Close full dancer profile and return to the previous page"
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

  async function shareProfile() {
    const url = window.location.href;
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

  return (
    <div className="profile-share">
      <button onClick={shareProfile} type="button">
        <ShareIcon />
        Share profile
      </button>
      <span aria-live="polite">{status}</span>
    </div>
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
