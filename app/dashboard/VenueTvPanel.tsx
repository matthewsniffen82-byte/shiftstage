"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type VenueTvVideo = {
  id: string;
  caption: string;
  videoUrl: string;
  status: string;
  venueTagStatus: string;
  venueFeatured: boolean;
  dancer?: { id: string; stageName: string; slug: string } | null;
  shift?: { id: string; startsAt: string; endsAt: string } | null;
  metrics?: Record<string, number>;
};

export default function VenueTvPanel() {
  const [videos, setVideos] = useState<VenueTvVideo[]>([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");

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

  async function updateVideo(
    video: VenueTvVideo,
    input: { tagStatus?: "confirmed" | "rejected"; featured?: boolean },
  ) {
    const action = input.tagStatus === "rejected"
      ? "reject this venue tag"
      : input.tagStatus === "confirmed"
        ? "confirm this venue tag"
        : input.featured
          ? "feature this video on your venue page"
          : "remove this video from the featured position";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;
    const token = readToken();
    if (!token) return setStatus("Venue sign in required.");
    setWorkingId(video.id);
    setStatus("Saving venue video update…");
    try {
      const response = await fetch("/api/venue/tv/videos", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ videoId: video.id, ...input }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update venue video.");
      setVideos((current) => current.map((item) => item.id === video.id
        ? {
            ...item,
            venueTagStatus: data.video.venue_tag_status,
            venueFeatured: data.video.venue_featured,
          }
        : item));
      setStatus(data.message || "Venue video updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update venue video.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <article className="info-panel venue-tv-panel">
      <VenueTvPanelStyles />
      <div className="venue-tv-title">
        <div>
          <h2>MyDancr TV</h2>
          <p>Confirm venue tags, feature approved videos, and measure customer interest.</p>
        </div>
        <Link href="/tv">Watch TV</Link>
      </div>
      {isLoading ? <p>Loading tagged videos…</p> : null}
      {status ? <div className="venue-tv-status" role="status">{status}</div> : null}
      <div className="venue-tv-list">
        {videos.map((video) => (
          <article className="venue-tv-video" key={video.id}>
            {video.videoUrl ? <video controls playsInline preload="metadata" src={video.videoUrl} /> : null}
            <div>
              <span>{video.status} · venue tag {video.venueTagStatus}</span>
              <strong>{video.dancer?.stageName || "Dancer"}</strong>
              <p>{video.caption}</p>
              {video.shift ? <small>Posted shift · {formatDate(video.shift.startsAt)}</small> : null}
              <dl>
                <div><dt>Engaged views</dt><dd>{video.metrics?.engaged_view || 0}</dd></div>
                <div><dt>Venue visits</dt><dd>{video.metrics?.venue_click || 0}</dd></div>
                <div><dt>Going</dt><dd>{video.metrics?.going || 0}</dd></div>
              </dl>
              <div className="venue-tv-actions">
                {video.venueTagStatus === "pending" ? (
                  <>
                    <button type="button" disabled={workingId === video.id} onClick={() => updateVideo(video, { tagStatus: "confirmed" })}>Confirm tag</button>
                    <button className="reject" type="button" disabled={workingId === video.id} onClick={() => updateVideo(video, { tagStatus: "rejected" })}>Reject tag</button>
                  </>
                ) : null}
                {video.status === "approved" && video.venueTagStatus === "confirmed" ? (
                  <button type="button" disabled={workingId === video.id} onClick={() => updateVideo(video, { featured: !video.venueFeatured })}>
                    {video.venueFeatured ? "Remove featured" : "Feature on venue page"}
                  </button>
                ) : null}
                {video.status === "approved" ? <Link href={`/tv/${video.id}`}>Open live</Link> : null}
              </div>
            </div>
          </article>
        ))}
        {!isLoading && !videos.length ? <p>No videos are currently connected to this venue.</p> : null}
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
      .venue-tv-actions button { min-height: 38px; padding: 0 11px; border: 1px solid rgba(58,255,164,.3); border-radius: 8px; color: #85ffc1; background: rgba(58,255,164,.07); font-weight: 900; cursor: pointer; }
      .venue-tv-actions button.reject { color: #ffb5c1; border-color: rgba(255,91,116,.3); background: rgba(255,91,116,.07); }
      @media (max-width: 620px) {
        .venue-tv-title { align-items: start; flex-direction: column; }
        .venue-tv-video { grid-template-columns: 96px minmax(0, 1fr); padding: 7px; }
        .venue-tv-video > video { width: 96px; max-height: 180px; }
        .venue-tv-video dl { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
