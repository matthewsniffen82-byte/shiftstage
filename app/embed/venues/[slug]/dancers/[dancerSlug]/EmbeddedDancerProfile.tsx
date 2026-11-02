"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_GUEST_ACCENT, guestAccentText, normalizeGuestAccent } from "@/src/lib/dancr/venue-guest-theme";
import PublicDancerProfile, { type PublicDancerProfileProps } from "@/app/dancers/[slug]/PublicDancerProfile";

function notifyProfileHost(type: "ready" | "close") {
  if (!window.parent || window.parent === window || new URLSearchParams(window.location.search).get("overlay") !== "1") return false;
  try {
    // Only the same-origin grid owns this overlay; ordinary website embeds keep their navigation.
    if (window.parent.location.origin !== window.location.origin) return false;
    window.parent.postMessage({ type: `mydancr:embed-profile-${type}` }, window.location.origin);
    return true;
  } catch { return false; }
}

export default function EmbeddedDancerProfile({ venueSlug, returnHref, accent, mediaRevision, ...props }: PublicDancerProfileProps & {
  venueSlug: string;
  returnHref: string;
  accent: string;
  mediaRevision: string;
}) {
  const scope = `${venueSlug}/${props.profile.slug}`;
  const [current, setCurrent] = useState({ scope, available: true, profile: props.profile, tvVideos: props.tvVideos });
  const clubAccent = normalizeGuestAccent(accent) || DEFAULT_GUEST_ACCENT;
  const closeProfile = () => {
    if (!notifyProfileHost("close")) window.location.assign(returnHref);
  };
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let revision = mediaRevision;
    const controller = new AbortController();
    setCurrent({ scope, available: true, profile: props.profile, tvVideos: props.tvVideos });
    const unavailable = () => { if (!disposed) setCurrent(previous => ({ ...previous, available: false })); };
    async function checkPresence() {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const response = await fetch(`/api/public/venue-grid/${encodeURIComponent(venueSlug)}/dancers/${encodeURIComponent(props.profile.slug)}?presence=1&media=1`, {
          credentials: "omit", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        const data = response.ok ? await response.json() : null;
        if (disposed) return;
        if (!data?.ok || typeof data.mediaRevision !== "string" || data.media?.profile?.id !== props.profile.id
          || !Array.isArray(data.media.profile.photos) || !Array.isArray(data.media.tvVideos)) {
          unavailable();
          return;
        }
        // Keep the same profile/gallery mounted. Replace withdrawn media in the same update.
        const unchanged = data.mediaRevision === revision;
        setCurrent(previous => unchanged && previous.available ? previous : {
          scope, available: true, profile: { ...props.profile, ...data.media.profile }, tvVideos: data.media.tvVideos,
        });
        revision = data.mediaRevision;
      } catch {
        unavailable();
      } finally { busy = false; }
    }
    const timer = window.setInterval(checkPresence, 60000);
    const closeOnEscape = (event: KeyboardEvent) => {
      // Let an open photo, video, or deal dialog handle Escape first.
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (notifyProfileHost("close")) event.preventDefault();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("visibilitychange", checkPresence);
    notifyProfileHost("ready");
    void checkPresence();
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("visibilitychange", checkPresence);
    };
  }, [venueSlug, scope, props.profile, props.tvVideos, mediaRevision]);

  return (
    <div className="venue-embed-profile-page" data-venue-slug={venueSlug}
      style={{ "--embed-accent": clubAccent, "--embed-accent-text": guestAccentText(clubAccent) } as CSSProperties}
      onClickCapture={event => {
        // Account and club pages stay in the main app; never frame private pages.
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (anchor && !new URL(anchor.href).pathname.startsWith("/embed/venues/")) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
      }}>
      {current.scope === scope && current.available ? <PublicDancerProfile {...props} profile={current.profile} tvVideos={current.tvVideos} embedded
        goingEndpoint={`/api/public/venue-grid/${encodeURIComponent(venueSlug)}/dancers/${encodeURIComponent(props.profile.slug)}/going`}
        onClose={closeProfile} /> : (
        <section className="venue-embed-profile-unavailable">
          <h1>Profile unavailable</h1>
          <p role="status">This profile is no longer available or could not be verified. Return to the grid to see who’s working now.</p>
          <a href={returnHref} onClick={event => { event.preventDefault(); closeProfile(); }}>← Working now</a>
        </section>
      )}
      <footer className="venue-embed-profile-credit">
        <a href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer">
          <span>Powered by mydancr.com</span>
        </a>
      </footer>
    </div>
  );
}
