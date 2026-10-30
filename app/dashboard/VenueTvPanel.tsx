"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { homeTvHref } from "@/src/lib/dancr/navigation";
import { readDashboardAccessToken, requestVenueTvVideosJson } from "./dashboard-session";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";

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
          setStatus("Club sign in required.");
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
        setStatus(error instanceof Error ? error.message : "Unable to load club videos.");
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
    <section className="venue-tv-launcher" id="venue-tv" hidden={hidden} aria-labelledby="venue-tv-heading" tabIndex={-1}>
      <VenueTvPanelStyles />
      <Link className="venue-tv-launch-button" href={homeTvHref(city, { venueId })} title="View club TV" aria-labelledby="venue-tv-heading" aria-describedby="venue-tv-count">
        <VenueDashboardIcon section="tv" />
        <span className="venue-tv-launch-label" id="venue-tv-heading">MyDancr TV</span>
        <span className="venue-tv-launch-count" id="venue-tv-count" aria-live="polite">{isLoading ? "…" : status ? "Unavailable" : `${videos.length} ${videos.length === 1 ? "video" : "videos"}`}</span>
      </Link>
      {status ? <p className="venue-tv-status" role="status">{status}</p> : null}
      {!isLoading && !status && !videos.length ? <p>No videos yet.</p> : null}
    </section>
  );
}

function VenueTvPanelStyles() {
  return (
    <style>{`
      .venue-tv-launcher { grid-column: 1 / -1; min-width: 0; }
      .venue-tv-launcher[hidden] { display: none; }
      .venue-tv-launch-button { box-sizing: border-box; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; width: 100%; min-height: 56px; padding: 12px 16px; border: 1px solid var(--dancr-color-border); border-radius: 8px; background: var(--dancr-control-secondary-background); color: var(--dancr-color-text-primary); font-size: 16px; font-weight: 650; line-height: 1.5; text-decoration: none; }
      .venue-tv-launch-button > svg { width: 24px; height: 24px; flex: 0 0 24px; }
      .venue-tv-launch-label { min-width: 0; }
      .venue-tv-launch-count { margin-left: auto; color: var(--dancr-color-text-secondary); font-size: 13px; font-weight: 400; white-space: nowrap; }
      .venue-tv-launch-button:hover { background: var(--dancr-color-control-hover); }
      .venue-tv-launch-button:focus-visible { outline: 2px solid var(--dancr-color-brand-primary); outline-offset: 4px; }
      .venue-tv-launcher > p { margin: 4px 0 0; color: var(--dancr-color-text-secondary); font-size: 13px; line-height: 1.5; }
      .venue-tv-launcher > .venue-tv-status { color: #a9efff; }
    `}</style>
  );
}
