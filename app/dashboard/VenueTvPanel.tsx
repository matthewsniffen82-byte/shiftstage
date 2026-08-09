"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type VenueTvVideo = {
  id: string;
  videoUrl: string;
  status: string;
  dancer?: { id: string; stageName: string; slug: string } | null;
  shift?: { id: string; startsAt: string; endsAt: string; isActive: boolean } | null;
  metrics?: Record<string, number>;
};

export default function VenueTvPanel() {
  const [videos, setVideos] = useState<VenueTvVideo[]>([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadVideos();
  }, []);

  async function loadVideos() {
    const token = readToken();
    if (!token) {
      setStatus("Venue sign in required.");
      setIsLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/venue/tv/videos", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load venue videos.");
      setVideos(data.videos || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load venue videos.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <article className="info-panel venue-tv-panel">
      <VenueTvPanelStyles />
      <div className="venue-tv-title">
        <div>
          <h2>MyDancr TV</h2>
          <p>Approved videos appear automatically from verified current shifts and posted upcoming shifts.</p>
        </div>
        <Link href="/tv">Watch TV</Link>
      </div>
      {isLoading ? <p>Loading schedule-connected videos…</p> : null}
      {status ? <div className="venue-tv-status" role="status">{status}</div> : null}
      <div className="venue-tv-list">
        {videos.map((video) => (
          <article className="venue-tv-video" key={video.id}>
            {video.videoUrl ? <video controls playsInline preload="metadata" src={video.videoUrl} /> : null}
            <div>
              <span>{video.shift?.isActive ? "Working Now" : "Upcoming shift"}</span>
              <strong>{video.dancer?.stageName || "Dancer"}</strong>
              {video.shift ? <small>{video.shift.isActive ? "Verified current shift" : `Posted shift · ${formatDate(video.shift.startsAt)}`}</small> : null}
              <dl>
                <div><dt>Engaged views</dt><dd>{video.metrics?.engaged_view || 0}</dd></div>
                <div><dt>Venue visits</dt><dd>{video.metrics?.venue_click || 0}</dd></div>
                <div><dt>Going</dt><dd>{video.metrics?.going || 0}</dd></div>
              </dl>
              <div className="venue-tv-actions">
                {video.status === "approved" ? <Link href={`/tv/${video.id}`}>Open live</Link> : null}
              </div>
            </div>
          </article>
        ))}
        {!isLoading && !videos.length ? <p>No approved videos currently match a verified current shift or posted upcoming shift at this venue.</p> : null}
      </div>
    </article>
  );
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return session?.account?.role === "venue" && typeof session?.accessToken === "string"
      ? session.accessToken
      : "";
  } catch {
    return "";
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function VenueTvPanelStyles() {
  return (
    <style>{`
      .venue-tv-panel { grid-column: 1 / -1; }
      .venue-tv-title { display: flex; justify-content: space-between; align-items: end; gap: 12px; }
      .venue-tv-title > div { display: grid; gap: 4px; }
      .venue-tv-title h2, .venue-tv-title p, .venue-tv-video p { margin: 0; }
      .venue-tv-title p { color: #b9accd; }
      .venue-tv-title > a, .venue-tv-actions a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid rgba(34,199,255,.3); border-radius: 999px; color: #fff; background: rgba(34,199,255,.07); font-weight: 900; text-decoration: none; white-space: nowrap; }
      .venue-tv-status { padding: 9px 11px; border: 1px solid rgba(34,199,255,.24); border-radius: 8px; color: #a9efff; background: rgba(34,199,255,.07); }
      .venue-tv-list { display: grid; gap: 10px; margin-top: 12px; }
      .venue-tv-video { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(255,255,255,.035); }
      .venue-tv-video > video { width: 130px; aspect-ratio: 9 / 16; max-height: 240px; object-fit: contain; border-radius: 7px; background: #000; }
      .venue-tv-video > div { display: grid; align-content: start; gap: 7px; }
      .venue-tv-video > div > span, .venue-tv-video small { color: #a99ebc; font-size: 11px; }
      .venue-tv-video dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
      .venue-tv-video dl div { padding: 7px; border-radius: 7px; background: rgba(255,255,255,.04); }
      .venue-tv-video dt { color: #9f94b3; font-size: 10px; }
      .venue-tv-video dd { margin: 2px 0 0; font-weight: 950; }
      .venue-tv-actions { display: flex; flex-wrap: wrap; gap: 7px; }
      @media (max-width: 620px) {
        .venue-tv-title { align-items: start; flex-direction: column; }
        .venue-tv-video { grid-template-columns: 96px minmax(0, 1fr); padding: 7px; }
        .venue-tv-video > video { width: 96px; max-height: 180px; }
        .venue-tv-video dl { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
