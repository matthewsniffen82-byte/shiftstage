"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type AdminTvVideo = {
  id: string;
  videoUrl: string;
  status: string;
  venueTagStatus: string;
  reviewNotes?: string | null;
  moderationDecision?: string | null;
  moderationReasonCodes?: string[];
  moderationProviderFlagged?: boolean;
  moderationFrameCount?: number;
  moderationModel?: string | null;
  moderationDetails?: {
    audioChecked?: boolean;
    policyConfidence?: number;
    musicFingerprint?: {
      checked?: boolean;
      status?: "no_audio" | "no_match" | "matched";
      sampleCount?: number;
      reviewThreshold?: number;
      matchFound?: boolean;
      reviewRequired?: boolean;
      matches?: Array<{
        acrid?: string;
        title?: string;
        artists?: string[];
        album?: string | null;
        label?: string | null;
        isrc?: string | null;
        score?: number;
        sampleOffsetsSeconds?: number[];
      }>;
    };
  };
  submittedAt?: string | null;
  publishedAt?: string | null;
  dancer?: { id: string; stageName: string; slug: string; city: string } | null;
  venue?: { id: string; name: string; slug: string } | null;
  shift?: { id: string; startsAt: string; endsAt: string } | null;
};

export default function AdminTvPanel() {
  const [videos, setVideos] = useState<AdminTvVideo[]>([]);
  const [filter, setFilter] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");

  useEffect(() => {
    loadVideos(filter);
  }, [filter]);

  async function loadVideos(nextFilter: string) {
    const token = readToken();
    if (!token) {
      setStatus("Admin sign in required.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/tv/videos?status=${encodeURIComponent(nextFilter)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load video moderation.");
      setVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load video moderation.");
    } finally {
      setIsLoading(false);
    }
  }

  async function review(video: AdminTvVideo, decision: "approved" | "rejected") {
    const reviewNotes = (notes[video.id] || "").trim();
    if (decision === "rejected" && reviewNotes.length < 3) {
      setStatus("Enter a rejection reason so the dancer knows what needs to change.");
      return;
    }
    if (!window.confirm(
      decision === "approved"
        ? `Approve and publish ${video.dancer?.stageName || "this dancer"}’s video?`
        : `Reject this video and notify ${video.dancer?.stageName || "the dancer"}?`,
    )) return;

    const token = readToken();
    if (!token) return setStatus("Admin sign in required.");
    setWorkingId(video.id);
    setStatus(decision === "approved" ? "Approving and publishing…" : "Rejecting and notifying dancer…");
    try {
      const response = await fetch("/api/admin/tv/videos", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ videoId: video.id, decision, notes: reviewNotes }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to review video.");
      setVideos((current) => filter === "submitted"
        ? current.filter((item) => item.id !== video.id)
        : current.map((item) => item.id === video.id
          ? {
              ...item,
              status: decision,
              reviewNotes: reviewNotes || null,
              publishedAt: decision === "approved" ? new Date().toISOString() : item.publishedAt,
            }
          : item));
      setNotes((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
      setStatus(data.message || (decision === "approved" ? "Video approved and published." : "Video rejected."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to review video.");
    } finally {
      setWorkingId("");
    }
  }

  const pendingCount = videos.filter((video) => video.status === "submitted").length;

  return (
    <div className="admin-tv-panel">
      <AdminTvPanelStyles />
      <div className="admin-tv-head">
        <div>
          <strong>MyDancr TV moderation</strong>
          <span>
            {filter === "all"
              ? `${pendingCount} need review · ${videos.length} total`
              : filter === "submitted"
                ? `${videos.length} videos need review`
                : `${videos.length} ${filter} videos`}
          </span>
        </div>
        <label>
          Queue
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All videos</option>
            <option value="submitted">Needs review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      {isLoading ? <p>Loading real video submissions…</p> : null}
      {status ? <div className="admin-tv-status" role="status" aria-live="polite">{status}</div> : null}
      <div className="admin-tv-list">
        {videos.map((video) => (
          <article className="admin-tv-video" key={video.id}>
            {video.videoUrl ? <video controls playsInline preload="metadata" src={video.videoUrl} /> : <div className="admin-tv-missing">Video unavailable</div>}
            <div className="admin-tv-copy">
              <span>{video.status.replaceAll("_", " ")}</span>
              <h3>{video.dancer?.stageName || "Dancer"}</h3>
              <small>
                {video.dancer?.city || "City unavailable"}
                {video.venue ? ` · ${video.venue.name}` : " · No venue attached"}
                {video.shift ? ` · ${formatDate(video.shift.startsAt)}` : ""}
              </small>
              {video.moderationDecision ? (
                <div className={`admin-tv-ai-decision decision-${video.moderationDecision}`}>
                  <strong>Automated safety review: {video.moderationDecision}</strong>
                  <small>
                    {video.moderationFrameCount || 0} frames checked
                    {video.moderationDetails?.audioChecked ? " · audio checked" : " · no audio detected"}
                    {typeof video.moderationDetails?.policyConfidence === "number"
                      ? ` · ${Math.round(video.moderationDetails.policyConfidence * 100)}% policy confidence`
                      : ""}
                  </small>
                  {video.moderationDetails?.musicFingerprint ? (
                    <div className="admin-tv-music-rights">
                      <strong>
                        Music rights: {musicRightsStatus(video.moderationDetails.musicFingerprint)}
                      </strong>
                      {video.moderationDetails.musicFingerprint.matches?.length ? (
                        <ul>
                          {video.moderationDetails.musicFingerprint.matches.map((match) => (
                            <li key={match.acrid || `${match.title}-${match.isrc || "match"}`}>
                              {match.title || "Recognized track"}
                              {match.artists?.length ? ` · ${match.artists.join(", ")}` : ""}
                              {typeof match.score === "number" ? ` · ${Math.round(match.score)}% match` : ""}
                              {match.isrc ? ` · ISRC ${match.isrc}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {video.moderationReasonCodes?.length ? (
                    <ul>
                      {video.moderationReasonCodes.map((reason) => (
                        <li key={reason}>{readableReason(reason)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {video.moderationModel ? <small>Models: {video.moderationModel}</small> : null}
                </div>
              ) : null}
              {video.dancer ? <Link href={`/dancers/${video.dancer.slug}`}>Open dancer profile</Link> : null}
              {video.venue ? <Link href={`/venues/${video.venue.slug}`}>Open venue page</Link> : null}
              {video.status === "submitted" ? (
                <>
                  <label>
                    Review notes
                    <textarea
                      value={notes[video.id] || ""}
                      maxLength={1000}
                      rows={3}
                      placeholder="Required when rejecting; optional when approving"
                      onChange={(event) => setNotes((current) => ({ ...current, [video.id]: event.target.value }))}
                    />
                  </label>
                  <div className="admin-tv-actions">
                    <button type="button" disabled={workingId === video.id} onClick={() => review(video, "approved")}>
                      {workingId === video.id ? "Working…" : "Approve and publish"}
                    </button>
                    <button className="reject" type="button" disabled={workingId === video.id} onClick={() => review(video, "rejected")}>
                      Reject video
                    </button>
                  </div>
                </>
              ) : (
                <small>
                  {video.status === "approved" ? "Approved and published." : video.status === "rejected" ? "Rejected." : "Not awaiting review."}
                  {video.reviewNotes ? ` ${video.reviewNotes}` : ""}
                </small>
              )}
            </div>
          </article>
        ))}
        {!isLoading && !videos.length ? (
          <div className="admin-tv-empty">
            {filter === "submitted"
              ? "No MyDancr TV videos currently need review."
              : filter === "all"
                ? "No MyDancr TV videos have been submitted yet."
                : "No videos match this filter."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function musicRightsStatus(
  fingerprint: NonNullable<NonNullable<AdminTvVideo["moderationDetails"]>["musicFingerprint"]>,
) {
  if (fingerprint.status === "matched") {
    return fingerprint.reviewRequired
      ? "catalog match requires authorization review"
      : "low-confidence catalog match";
  }
  if (fingerprint.status === "no_match") return "no catalog match found";
  return "no audio detected";
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return session?.account?.role === "admin" && typeof session?.accessToken === "string"
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

function readableReason(value: string) {
  return value.replace(/^frame_\d+_/, "Frame: ").replace(/^text_/, "Text/audio: ").replace(/^policy_/, "Policy: ").replaceAll("_", " ");
}

function AdminTvPanelStyles() {
  return (
    <style>{`
      .admin-tv-panel, .admin-tv-list, .admin-tv-copy { display: grid; gap: 10px; }
      .admin-tv-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; }
      .admin-tv-head > div { display: grid; gap: 3px; }
      .admin-tv-head > div span { color: #94e5ff; font-size: 12px; }
      .admin-tv-head label, .admin-tv-copy label { display: grid; gap: 5px; color: #b9accd; font-size: 11px; font-weight: 850; }
      .admin-tv-head select, .admin-tv-copy textarea { min-height: 38px; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; color: #fff; background: rgba(255,255,255,.05); padding: 8px 10px; font: inherit; }
      .admin-tv-video { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; background: rgba(255,255,255,.035); }
      .admin-tv-video > video, .admin-tv-missing { width: 150px; aspect-ratio: 9 / 16; max-height: 270px; object-fit: contain; border-radius: 7px; background: #000; }
      .admin-tv-missing { display: grid; place-items: center; color: #9c90b3; font-size: 11px; }
      .admin-tv-copy > span { width: fit-content; color: #ffe19d; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .admin-tv-copy h3, .admin-tv-copy p { margin: 0; }
      .admin-tv-copy p { color: #ddd4ed; line-height: 1.4; }
      .admin-tv-copy small { color: #a99ebc; line-height: 1.4; }
      .admin-tv-copy > a { width: fit-content; color: #94e5ff; font-size: 12px; font-weight: 850; }
      .admin-tv-ai-decision { display: grid; gap: 5px; padding: 9px; border: 1px solid rgba(255,200,90,.24); border-radius: 8px; background: rgba(255,200,90,.05); }
      .admin-tv-ai-decision.decision-approved { border-color: rgba(58,255,164,.3); background: rgba(58,255,164,.06); }
      .admin-tv-ai-decision.decision-rejected { border-color: rgba(255,91,116,.32); background: rgba(255,91,116,.06); }
      .admin-tv-ai-decision strong { color: #fff; text-transform: capitalize; }
      .admin-tv-ai-decision ul { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; list-style: none; }
      .admin-tv-ai-decision li { padding: 3px 6px; border-radius: 999px; color: #d8cfeb; background: rgba(255,255,255,.07); font-size: 10px; text-transform: capitalize; }
      .admin-tv-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
      .admin-tv-actions button { min-height: 40px; border: 1px solid rgba(58,255,164,.34); border-radius: 8px; color: #0a1b12; background: #85ffc1; font-weight: 950; cursor: pointer; }
      .admin-tv-actions button.reject { color: #fff; border-color: rgba(255,91,116,.4); background: #bc3048; }
      .admin-tv-actions button:disabled { opacity: .65; cursor: wait; }
      .admin-tv-status { padding: 9px 10px; border: 1px solid rgba(34,199,255,.24); border-radius: 8px; color: #a9efff; background: rgba(34,199,255,.07); font-size: 12px; font-weight: 800; }
      .admin-tv-empty { padding: 18px; border: 1px dashed rgba(255,255,255,.14); border-radius: 8px; color: #a99ebc; text-align: center; }
      @media (max-width: 680px) {
        .admin-tv-head { align-items: stretch; flex-direction: column; }
        .admin-tv-video { grid-template-columns: 104px minmax(0, 1fr); padding: 7px; }
        .admin-tv-video > video, .admin-tv-missing { width: 104px; max-height: 200px; }
        .admin-tv-actions { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
