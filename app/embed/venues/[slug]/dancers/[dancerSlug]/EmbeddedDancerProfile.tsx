"use client";

import { useEffect, useState, type CSSProperties } from "react";
import PublicDancerProfile, { type PublicDancerProfileProps } from "@/app/dancers/[slug]/PublicDancerProfile";

export default function EmbeddedDancerProfile({ venueSlug, returnHref, accent, ...props }: PublicDancerProfileProps & {
  venueSlug: string;
  returnHref: string;
  accent: string;
}) {
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const controller = new AbortController();
    async function checkPresence() {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const response = await fetch(`/api/public/venue-grid/${encodeURIComponent(venueSlug)}/dancers/${encodeURIComponent(props.profile.slug)}?presence=1`, {
          credentials: "omit", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!disposed && (!response.ok || !(await response.json()).ok)) setAvailable(false);
      } catch {
        if (!disposed) setAvailable(false);
      } finally { busy = false; }
    }
    const timer = window.setInterval(checkPresence, 60000);
    document.addEventListener("visibilitychange", checkPresence);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkPresence);
    };
  }, [venueSlug, props.profile.slug]);

  return (
    <div className="venue-embed-profile-page" style={{ "--embed-accent": accent } as CSSProperties}
      onClickCapture={event => {
        // Account and club pages stay in the main app; never frame private pages.
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (anchor && !new URL(anchor.href).pathname.startsWith("/embed/venues/")) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
      }}>
      {available ? <PublicDancerProfile {...props} embedded onClose={() => window.location.assign(returnHref)} /> : (
        <section className="venue-embed-profile-unavailable">
          <h1>Profile unavailable</h1>
          <p role="status">This dancer may no longer be working here. Return to the grid to see who’s working now.</p>
          <a href={returnHref}>← Working now</a>
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
