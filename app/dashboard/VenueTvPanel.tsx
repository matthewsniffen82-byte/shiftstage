"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { homeTvHref } from "@/src/lib/dancr/navigation";
import { readDashboardAccessToken, requestVenueTvVideosJson } from "./dashboard-session";

type VenueTvVideo = {
  id: string;
};

export default function VenueTvPanel({ city, venueId, hidden = false }: { city: string; venueId: string; hidden?: boolean }) {
  const [videos, setVideos] = useState<VenueTvVideo[]>([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    setStatus("");
    setVideos([]);

    async function loadVideos() {
      const token = readDashboardAccessToken("venue");
      if (!token) {
        if (!cancelled) {
          setStatus("Venue sign in required.");
          setIsLoading(false);
        }
        return;
      }
      try {
        const data = await requestVenueTvVideosJson({
          cache: "no-store",
          signal: controller.signal,
        });
        if (!cancelled) setVideos(data.videos || []);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus(error instanceof Error ? error.message : "Unable to load venue videos.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadVideos();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [venueId]);

  return (
    <section className="venue-tv-panel" id="venue-tv" hidden={hidden} aria-labelledby="venue-tv-heading" tabIndex={-1}>
      <VenueTvPanelStyles />
      <div className="venue-tv-title">
        <h2 id="venue-tv-heading">MyDancr TV <span aria-live="polite">· {isLoading ? "…" : status ? "Unavailable" : `${videos.length} ${videos.length === 1 ? "video" : "videos"}`}</span></h2>
        <Link href={homeTvHref(city, { venueId })}>View venue TV</Link>
      </div>
      {status ? <p className="venue-tv-status" role="status">{status}</p> : null}
      {!isLoading && !status && !videos.length ? <p>No videos yet.</p> : null}
    </section>
  );
}

function VenueTvPanelStyles() {
  return (
    <style>{`
      .venue-tv-panel { grid-column: 1 / -1; padding: 16px 18px; border: 1px solid var(--mydancr-dashboard-border, #302538); border-radius: 16px; background: var(--mydancr-dashboard-panel, #100d15); }
      .venue-tv-panel[hidden] { display: none; }
      .venue-tv-title { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
      .venue-tv-title h2 { margin: 0; color: #f3f0f7; font: inherit; font-size: 16px; font-weight: 650; line-height: 1.5; }
      .venue-tv-title h2 span { color: #aaa4b6; font-size: 13px; font-weight: 400; white-space: nowrap; }
      .venue-tv-title > a { min-height: 40px; display: inline-flex; align-items: center; color: #c4b5fd; font-size: 13px; font-weight: 650; text-decoration: none; }
      .venue-tv-title > a:hover { text-decoration: underline; }
      .venue-tv-title > a:focus-visible { outline: 2px solid #a78bfa; outline-offset: 4px; border-radius: 3px; }
      .venue-tv-panel > p { margin: 4px 0 0; color: #aaa4b6; font-size: 13px; line-height: 1.5; }
      .venue-tv-panel > .venue-tv-status { color: #a9efff; }
    `}</style>
  );
}
