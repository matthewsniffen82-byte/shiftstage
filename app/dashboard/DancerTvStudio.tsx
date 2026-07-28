"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createBrowserSupabaseClient } from "@/src/lib/supabase/client";

const SESSION_KEY = "dancrAuthSessionV1";

type Workspace = {
  profileEligible: boolean;
  profileVisible: boolean;
  videos: ManagedVideo[];
  shifts: Array<{
    id: string;
    venueId: string;
    venueName: string;
    startsAt: string;
    endsAt: string;
    venueTagConfirmed: boolean;
  }>;
  venues: Array<{ id: string; name: string; slug: string; city: string }>;
};

type ManagedVideo = {
  id: string;
  caption: string;
  videoUrl: string;
  status: string;
  venueTagStatus: string;
  venueFeatured: boolean;
  reviewNotes?: string | null;
  moderationDecision?: "approved" | "review" | "rejected" | null;
  moderationFrameCount?: number;
  submittedAt?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  venue?: { id: string; name: string; slug: string } | null;
  shift?: { id: string; startsAt: string; endsAt: string } | null;
  metrics?: Record<string, number>;
};

export default function DancerTvStudio({ embedded = false }: { embedded?: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedShift = useMemo(
    () => workspace?.shifts.find((shift) => shift.id === shiftId) || null,
    [shiftId, workspace?.shifts],
  );

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function loadWorkspace() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in as a dancer to manage MyDancr TV.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/dancer/tv/videos", {
        headers: authHeaders(session),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load MyDancr TV Studio.");
      setWorkspace(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load MyDancr TV Studio.");
    } finally {
      setIsLoading(false);
    }
  }

  function chooseFile(nextFile: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : "");
    setStatus("");
  }

  async function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in as a dancer to upload.");
    if (!file) return setStatus("Choose an MP4 or WebM video first.");
    if (!caption.trim()) return setStatus("Add a caption before submitting.");
    if (!consentConfirmed || !rightsConfirmed) {
      return setStatus("Confirm consent and content rights before submitting.");
    }

    setIsSubmitting(true);
    setStatus("Checking your video…");
    try {
      const metadata = await readVideoMetadata(file);
      const response = await fetch("/api/dancer/tv/videos", {
        method: "POST",
        headers: { ...authHeaders(session), "content-type": "application/json" },
        body: JSON.stringify({
          caption,
          mimeType: file.type,
          fileSize: file.size,
          durationSeconds: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          shiftId: shiftId || null,
          venueId: shiftId ? null : venueId || null,
          consentConfirmed,
          rightsConfirmed,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to prepare upload.");

      setStatus("Uploading securely…");
      const supabase = createBrowserSupabaseClient();
      const { error: uploadError } = await supabase.storage
        .from("mydancr-tv-videos")
        .uploadToSignedUrl(data.upload.path, data.upload.token, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      setStatus("Running automated video safety review…");
      const submitResponse = await fetch(`/api/dancer/tv/videos/${data.upload.videoId}`, {
        method: "PATCH",
        headers: { ...authHeaders(session), "content-type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      const submitted = await submitResponse.json();
      if (!submitResponse.ok || !submitted.ok) {
        throw new Error(submitted.error || "Unable to submit video for review.");
      }

      setStatus(submitted.message || "Your video completed automated safety review.");
      setFile(null);
      setCaption("");
      setShiftId("");
      setVenueId("");
      setConsentConfirmed(false);
      setRightsConfirmed(false);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
      if (inputRef.current) inputRef.current.value = "";
      await loadWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit your video.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeVideo(videoId: string) {
    if (!window.confirm("Remove this video from MyDancr TV?")) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setRemovingId(videoId);
    setStatus("");
    try {
      const response = await fetch(`/api/dancer/tv/videos/${videoId}`, {
        method: "DELETE",
        headers: authHeaders(session),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove video.");
      setWorkspace((current) => current
        ? { ...current, videos: current.videos.filter((video) => video.id !== videoId) }
        : current);
      setStatus(data.message || "Video removed from MyDancr TV.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove video.");
    } finally {
      setRemovingId("");
    }
  }

  const content = (
    <>
      <DancerTvStudioStyles />
      <div className="tv-studio-head">
        <div>
          <span>Creator tools</span>
          <h2>MyDancr TV Studio</h2>
          <p>Post vertical videos tied to your real profile, venue, or shift. Automated safety review checks the complete video before it can go live.</p>
        </div>
        <Link href="/tv">Watch MyDancr TV</Link>
      </div>

      {isLoading ? <p className="tv-studio-status">Loading your real videos…</p> : null}
      {!isLoading && workspace && !workspace.profileEligible ? (
        <div className="tv-studio-lock">
          <strong>Profile approval required</strong>
          <p>Your identity, photos, and dancer profile must be approved before you can submit public videos.</p>
        </div>
      ) : null}
      {workspace && !workspace.profileVisible ? (
        <div className="tv-studio-incognito">
          <strong>Incognito is on</strong>
          <p>Your approved videos remain saved but are hidden from customers until you turn your profile back on.</p>
        </div>
      ) : null}

      {workspace?.profileEligible ? (
        <form className="tv-upload-form" onSubmit={submitVideo}>
          <label className="tv-file-picker">
            Video file
            <input
              ref={inputRef}
              accept="video/mp4,video/webm"
              type="file"
              onChange={(event) => chooseFile(event.target.files?.[0] || null)}
              required
            />
            <small>Vertical or square MP4/WebM · 1–10 seconds · 75 MB maximum</small>
          </label>
          {previewUrl ? <video className="tv-upload-preview" controls playsInline src={previewUrl} /> : null}
          <label>
            Caption
            <textarea
              value={caption}
              maxLength={500}
              rows={4}
              placeholder="Tell customers what this video is about."
              onChange={(event) => setCaption(event.target.value)}
              required
            />
            <small>{caption.length}/500</small>
          </label>
          <label>
            Connect a posted shift
            <select value={shiftId} onChange={(event) => {
              setShiftId(event.target.value);
              if (event.target.value) setVenueId("");
            }}>
              <option value="">No shift attached</option>
              {workspace.shifts.map((shift) => (
                <option value={shift.id} key={shift.id}>
                  {shift.venueName} · {formatDate(shift.startsAt)}
                </option>
              ))}
            </select>
          </label>
          {!selectedShift ? (
            <label>
              Connect a venue
              <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
                <option value="">No venue attached</option>
                {workspace.venues.map((venue) => (
                  <option value={venue.id} key={venue.id}>{venue.name}</option>
                ))}
              </select>
              <small>A venue-only tag must be confirmed by that venue.</small>
            </label>
          ) : (
            <div className="tv-shift-confirmation">
              <strong>{selectedShift.venueName}</strong>
              <span>
                {formatDate(selectedShift.startsAt)}
                {" · "}
                {selectedShift.venueTagConfirmed
                  ? "Venue verified through your location-confirmed check-in"
                  : "Venue tag will be sent to the venue for confirmation"}
              </span>
            </div>
          )}
          <label className="tv-check">
            <input checked={consentConfirmed} type="checkbox" onChange={(event) => setConsentConfirmed(event.target.checked)} />
            <span>I have permission from every identifiable person shown.</span>
          </label>
          <label className="tv-check">
            <input checked={rightsConfirmed} type="checkbox" onChange={(event) => setRightsConfirmed(event.target.checked)} />
            <span>I own this video or have the rights to publish its video and audio.</span>
          </label>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Uploading and submitting…" : "Submit for MyDancr TV review"}
          </button>
        </form>
      ) : null}

      {status ? <div className="tv-studio-status" role="status" aria-live="polite">{status}</div> : null}

      <section className="tv-video-manager">
        <div className="tv-manager-title">
          <h3>My videos</h3>
          <span>{workspace?.videos.length || 0}</span>
        </div>
        <div className="tv-managed-grid">
          {workspace?.videos.map((video) => (
            <article className="tv-managed-video" key={video.id}>
              {video.videoUrl ? <video controls playsInline preload="metadata" src={video.videoUrl} /> : <div className="tv-video-unavailable">Video unavailable</div>}
              <div>
                <span className={`tv-video-status status-${video.status}`}>{statusLabel(video.status)}</span>
                <strong>{video.caption}</strong>
                {video.venue ? <small>{video.venue.name} · venue tag {video.venueTagStatus}</small> : null}
                {video.moderationDecision ? (
                  <small className="tv-moderation-summary">
                    Automated review: {video.moderationDecision === "review" ? "sent to a person" : video.moderationDecision}
                    {video.moderationFrameCount ? ` · ${video.moderationFrameCount} video frames checked` : ""}
                  </small>
                ) : null}
                {video.reviewNotes ? <p>{video.reviewNotes}</p> : null}
                {video.metrics ? (
                  <dl>
                    <div><dt>Engaged views</dt><dd>{video.metrics.engaged_view || 0}</dd></div>
                    <div><dt>Profile visits</dt><dd>{video.metrics.profile_click || 0}</dd></div>
                    <div><dt>Venue visits</dt><dd>{video.metrics.venue_click || 0}</dd></div>
                    <div><dt>Going</dt><dd>{video.metrics.going || 0}</dd></div>
                  </dl>
                ) : null}
                {video.status === "approved" ? <Link href={`/tv/${video.id}`}>Open live video</Link> : null}
                <button type="button" disabled={removingId === video.id} onClick={() => removeVideo(video.id)}>
                  {removingId === video.id ? "Removing…" : "Remove video"}
                </button>
              </div>
            </article>
          ))}
          {!workspace?.videos.length ? <p className="tv-no-videos">No videos submitted yet.</p> : null}
        </div>
      </section>
    </>
  );

  return embedded
    ? <article className="info-panel tv-studio-embedded">{content}</article>
    : <main className="tv-studio-page">{content}</main>;
}

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function authHeaders(session: any) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(session.refreshToken ? { "x-dancr-refresh-token": session.refreshToken } : {}),
  };
}

async function readVideoMetadata(file: File) {
  if (!["video/mp4", "video/webm"].includes(file.type)) throw new Error("Upload an MP4 or WebM video.");
  if (file.size > 75 * 1024 * 1024) throw new Error("Video files must be 75 MB or smaller.");

  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
      const element = document.createElement("video");
      element.preload = "metadata";
      element.onloadedmetadata = () => resolve({
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
      });
      element.onerror = () => reject(new Error("This video could not be read. Try a different MP4 or WebM file."));
      element.src = url;
    });
    if (!Number.isFinite(metadata.duration) || metadata.duration < 1 || metadata.duration > 10) {
      throw new Error("Videos must be between 1 and 10 seconds.");
    }
    if (metadata.height < metadata.width) {
      throw new Error("Use a vertical or square video for MyDancr TV.");
    }
    return metadata;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function statusLabel(status: string) {
  return ({
    uploading: "Upload incomplete",
    moderating: "Safety check",
    submitted: "Under review",
    approved: "Live",
    rejected: "Not approved",
    hidden: "Removed",
    expired: "Expired",
  } as Record<string, string>)[status] || status;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function DancerTvStudioStyles() {
  return (
    <style>{`
      .tv-studio-page { min-height: 100vh; padding: 28px clamp(14px, 4vw, 54px) 60px; background: radial-gradient(circle at 10% 0%, rgba(139,92,246,.22), transparent 26rem), #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .tv-studio-page > * { max-width: 920px; margin-left: auto; margin-right: auto; }
      .tv-studio-embedded { grid-column: 1 / -1; }
      .tv-studio-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
      .tv-studio-head > div { display: grid; gap: 7px; }
      .tv-studio-head span { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .tv-studio-head h2 { margin: 0; font-size: clamp(30px, 5vw, 50px); line-height: 1; }
      .tv-studio-head p { margin: 0; max-width: 58ch; color: #b9accd; line-height: 1.5; }
      .tv-studio-head > a, .tv-managed-video a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(34,199,255,.38); border-radius: 999px; color: #fff; background: rgba(34,199,255,.08); font-weight: 900; text-decoration: none; white-space: nowrap; }
      .tv-upload-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; padding: 18px; border: 1px solid rgba(139,92,246,.3); border-radius: 12px; background: rgba(11,11,16,.84); }
      .tv-upload-form > label { display: grid; align-content: start; gap: 7px; color: #ddd4ed; font-size: 13px; font-weight: 850; }
      .tv-file-picker, .tv-upload-preview, .tv-upload-form > label:nth-of-type(2), .tv-upload-form > button { grid-column: 1 / -1; }
      .tv-upload-form input[type="file"], .tv-upload-form textarea, .tv-upload-form select { width: 100%; min-height: 44px; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; color: #fff; background: rgba(255,255,255,.05); padding: 10px 12px; font: inherit; }
      .tv-upload-form textarea { resize: vertical; }
      .tv-upload-form small { color: #9f94b3; font-size: 11px; font-weight: 700; }
      .tv-upload-preview { width: min(360px, 100%); max-height: 560px; justify-self: center; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: #000; }
      .tv-check { grid-column: 1 / -1; grid-template-columns: 20px minmax(0, 1fr) !important; align-items: start; }
      .tv-check input { width: 18px; height: 18px; }
      .tv-shift-confirmation { display: grid; gap: 4px; padding: 12px; border: 1px solid rgba(34,199,255,.22); border-radius: 8px; background: rgba(34,199,255,.07); }
      .tv-shift-confirmation span { color: #a9dce8; font-size: 12px; }
      .tv-upload-form > button { min-height: 50px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; cursor: pointer; }
      .tv-upload-form > button:disabled { opacity: .65; cursor: wait; }
      .tv-studio-status, .tv-studio-lock, .tv-studio-incognito { margin-top: 12px; padding: 12px 14px; border: 1px solid rgba(34,199,255,.24); border-radius: 8px; background: rgba(34,199,255,.07); color: #b5f1ff; line-height: 1.5; }
      .tv-studio-lock, .tv-studio-incognito { display: grid; gap: 4px; }
      .tv-studio-lock p, .tv-studio-incognito p { margin: 0; color: #cfc5de; }
      .tv-studio-incognito { border-color: rgba(255,200,90,.3); background: rgba(255,200,90,.07); color: #ffe19d; }
      .tv-video-manager { margin-top: 22px; display: grid; gap: 12px; }
      .tv-manager-title { display: flex; align-items: center; justify-content: space-between; }
      .tv-manager-title h3 { margin: 0; font-size: 23px; }
      .tv-manager-title span { min-width: 34px; min-height: 28px; display: grid; place-items: center; border-radius: 999px; color: #7eeaff; background: rgba(34,199,255,.09); font-weight: 900; }
      .tv-managed-grid { display: grid; gap: 12px; }
      .tv-managed-video { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 13px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; background: rgba(11,11,16,.82); }
      .tv-managed-video > video, .tv-video-unavailable { width: 180px; aspect-ratio: 9 / 16; max-height: 310px; object-fit: contain; border-radius: 8px; background: #000; }
      .tv-video-unavailable { display: grid; place-items: center; color: #9f94b3; font-size: 12px; }
      .tv-managed-video > div { display: grid; align-content: start; gap: 8px; }
      .tv-managed-video strong { overflow-wrap: anywhere; }
      .tv-managed-video small { color: #a99ebc; }
      .tv-managed-video p { margin: 0; padding: 9px; border: 1px solid rgba(255,91,116,.22); border-radius: 8px; color: #ffc2cc; background: rgba(255,91,116,.06); }
      .tv-video-status { width: fit-content; padding: 5px 8px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #d8d0e8; font-size: 10px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .tv-video-status.status-approved { color: #85ffc1; border-color: rgba(58,255,164,.32); background: rgba(58,255,164,.07); }
      .tv-video-status.status-moderating { color: #94e5ff; border-color: rgba(34,199,255,.34); background: rgba(34,199,255,.08); }
      .tv-video-status.status-submitted { color: #ffe19d; border-color: rgba(255,200,90,.3); background: rgba(255,200,90,.07); }
      .tv-video-status.status-rejected { color: #ffb5c1; border-color: rgba(255,91,116,.3); background: rgba(255,91,116,.07); }
      .tv-moderation-summary { color: #bcd4ff !important; }
      .tv-managed-video dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 0; }
      .tv-managed-video dl div { display: grid; gap: 3px; padding: 8px; border-radius: 7px; background: rgba(255,255,255,.04); }
      .tv-managed-video dt { color: #9f94b3; font-size: 10px; }
      .tv-managed-video dd { margin: 0; font-weight: 950; }
      .tv-managed-video button { min-height: 38px; justify-self: start; padding: 0 12px; border: 1px solid rgba(255,91,116,.22); border-radius: 8px; color: #ffb5c1; background: rgba(255,91,116,.06); font-weight: 850; cursor: pointer; }
      .tv-no-videos { color: #9f94b3; }
      @media (max-width: 680px) {
        .tv-studio-page { padding: 18px 10px 50px; }
        .tv-studio-head { align-items: start; flex-direction: column; }
        .tv-upload-form { grid-template-columns: 1fr; padding: 12px; }
        .tv-upload-form > * { grid-column: auto !important; }
        .tv-managed-video { grid-template-columns: 112px minmax(0, 1fr); padding: 8px; }
        .tv-managed-video > video, .tv-video-unavailable { width: 112px; max-height: 210px; }
        .tv-managed-video dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `}</style>
  );
}
