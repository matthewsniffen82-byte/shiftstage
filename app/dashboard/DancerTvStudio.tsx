"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { createBrowserSupabaseClient } from "@/src/lib/supabase/client";
import {
  readDashboardAccessToken,
  requestDancerTvVideoJson,
  requestDancerTvVideosJson,
} from "./dashboard-session";
const MAX_VIDEO_DURATION_SECONDS = 30;

type Workspace = {
  profile: {
    stageName: string;
    slug: string;
  };
  profileEligible: boolean;
  profileVisible: boolean;
  maxVideos: number;
  remainingVideoSlots: number;
  videos: ManagedVideo[];
};

type ManagedVideo = {
  id: string;
  videoUrl: string;
  status: string;
  reviewNotes?: string | null;
  moderationDecision?: "approved" | "review" | "rejected" | null;
  moderationFrameCount?: number;
  submittedAt?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  metrics?: Record<string, number>;
};

type QueuedVideo = {
  id: string;
  file: File;
  previewUrl: string;
  source: "library" | "camera";
  stage: "queued" | "validating" | "uploading" | "checking" | "failed";
  progress: number;
  error?: string;
};

export default function DancerTvStudio({ embedded = false }: { embedded?: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [queuedVideos, setQueuedVideos] = useState<QueuedVideo[]>([]);
  const [uploadingQueueItemId, setUploadingQueueItemId] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const consentInputRef = useRef<HTMLInputElement>(null);
  const rightsInputRef = useRef<HTMLInputElement>(null);
  const queuedPreviewUrlsRef = useRef<Set<string>>(new Set());
  const maxVideos = workspace?.maxVideos || 5;
  const currentVideoCount = workspace?.videos.length || 0;
  const atVideoLimit = currentVideoCount >= maxVideos;
  const videoPermissionsConfirmed = consentConfirmed && rightsConfirmed;

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => () => {
    queuedPreviewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    queuedPreviewUrlsRef.current.clear();
  }, []);

  async function loadWorkspace() {
    if (!readDashboardAccessToken("dancer")) {
      setStatus("Sign in as a dancer to manage MyDancr TV.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await requestDancerTvVideosJson({
        cache: "no-store",
        fallbackMessage: "Unable to load MyDancr TV Studio.",
      });
      setWorkspace(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load MyDancr TV Studio.");
    } finally {
      setIsLoading(false);
    }
  }

  function queueVideoFiles(files: File[], source: QueuedVideo["source"]) {
    if (!consentConfirmed || !rightsConfirmed) {
      setStatus("Confirm both permissions before choosing videos. Your selection will upload automatically.");
      return;
    }

    const availableSlots = Math.max(0, maxVideos - currentVideoCount - queuedVideos.length);
    const selectedFiles = files.slice(0, availableSlots);
    if (!selectedFiles.length) {
      setStatus(`All ${maxVideos} profile video slots are occupied. Remove a video before adding another.`);
      return;
    }

    const additions = selectedFiles.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      queuedPreviewUrlsRef.current.add(previewUrl);
      const validType = file.type.startsWith("video/");
      return {
        id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
        file,
        previewUrl,
        source,
        stage: validType ? "queued" : "failed",
        progress: 0,
        error: validType ? undefined : "Choose an MP4, WebM, or MOV video.",
      } satisfies QueuedVideo;
    });
    const omitted = files.length - selectedFiles.length;
    setQueuedVideos((current) => [...current, ...additions]);
    setStatus(`${additions.length} ${additions.length === 1 ? "video" : "videos"} selected. Upload started automatically${omitted ? `. ${omitted} exceeded the available profile slots.` : "."}`);
    const uploadable = additions.filter((item) => !item.error);
    if (uploadable.length) void uploadVideoBatch(uploadable);
  }

  function openVideoSource(input: HTMLInputElement | null) {
    if (isSubmitting) return;
    if (!videoPermissionsConfirmed) {
      setStatus("Check both permission boxes first.");
      const missingPermission = !consentConfirmed ? consentInputRef.current : rightsInputRef.current;
      window.requestAnimationFrame(() => missingPermission?.focus());
      return;
    }
    setStatus("");
    input?.click();
  }

  function updateQueuedVideo(id: string, changes: Partial<QueuedVideo>) {
    setQueuedVideos((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  function removeQueuedVideo(id: string) {
    setQueuedVideos((current) => current.filter((item) => {
      if (item.id !== id) return true;
      queuedPreviewUrlsRef.current.delete(item.previewUrl);
      URL.revokeObjectURL(item.previewUrl);
      return false;
    }));
  }

  async function uploadVideoBatch(batch: QueuedVideo[]) {
    if (!readDashboardAccessToken("dancer")) return setStatus("Sign in as a dancer to upload.");
    if (atVideoLimit) return setStatus(`You can upload up to ${maxVideos} profile videos. Remove one before adding another.`);
    if (!batch.length) return setStatus("Choose up to five MP4, WebM, or MOV videos, or record a new video first.");
    if (!consentConfirmed || !rightsConfirmed) {
      return setStatus("Confirm consent and content rights for every queued video before submitting.");
    }

    setIsSubmitting(true);
    const failedItems: QueuedVideo[] = [];
    let submittedCount = 0;
    try {
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index];
        let preparedVideoId = "";
        setUploadingQueueItemId(item.id);
        updateQueuedVideo(item.id, { stage: "validating", progress: 10, error: undefined });
        setStatus(`Checking video ${index + 1} of ${batch.length}...`);
        try {
          const metadata = await readVideoMetadata(item.file);
          updateQueuedVideo(item.id, { stage: "uploading", progress: 30 });
          const data = await requestDancerTvVideosJson({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mimeType: item.file.type,
              fileSize: item.file.size,
              durationSeconds: metadata.duration,
              width: metadata.width,
              height: metadata.height,
              consentConfirmed,
              rightsConfirmed,
            }),
            fallbackMessage: "Unable to prepare upload.",
          });
          preparedVideoId = String(data.upload.videoId || "");

          setStatus(`Uploading video ${index + 1} of ${batch.length} securely...`);
          const supabase = createBrowserSupabaseClient();
          const { error: uploadError } = await supabase.storage
            .from("mydancr-tv-videos")
            .uploadToSignedUrl(data.upload.path, data.upload.token, item.file, {
              contentType: item.file.type,
              upsert: false,
            });
          if (uploadError) throw uploadError;

          updateQueuedVideo(item.id, { stage: "checking", progress: 85 });
          setStatus(`Running safety review for video ${index + 1} of ${batch.length}...`);
          const submitted = await requestDancerTvVideoJson(preparedVideoId, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "submit" }),
            fallbackMessage: "Unable to submit video for review.",
          });

          submittedCount += 1;
          queuedPreviewUrlsRef.current.delete(item.previewUrl);
          URL.revokeObjectURL(item.previewUrl);
        } catch (error) {
          if (preparedVideoId) {
            await requestDancerTvVideoJson(preparedVideoId, {
              method: "DELETE",
            }).catch(() => undefined);
          }
          failedItems.push({
            ...item,
            stage: "failed",
            progress: 0,
            error: error instanceof Error ? error.message : "Unable to submit this video.",
          });
        }
      }

      const processedIds = new Set(batch.map((item) => item.id));
      setQueuedVideos((current) => [
        ...current.filter((item) => !processedIds.has(item.id)),
        ...failedItems,
      ]);
      if (libraryInputRef.current) libraryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (submittedCount) await loadWorkspace();
      setStatus([
        submittedCount ? `${submittedCount} ${submittedCount === 1 ? "video" : "videos"} uploaded and sent through automatic review` : "",
        failedItems.length ? `${failedItems.length} ready to retry` : "",
      ].filter(Boolean).join(". ") || "No videos were uploaded.");
    } finally {
      setUploadingQueueItemId("");
      setIsSubmitting(false);
    }
  }

  async function removeVideo(videoId: string) {
    if (!window.confirm("Remove this video from MyDancr TV?")) return;
    if (!readDashboardAccessToken("dancer")) return setStatus("Sign in required.");
    setRemovingId(videoId);
    setStatus("");
    try {
      const data = await requestDancerTvVideoJson(videoId, {
        method: "DELETE",
        fallbackMessage: "Unable to remove video.",
      });
      setWorkspace((current) => current
        ? {
          ...current,
          videos: current.videos.filter((video) => video.id !== videoId),
          remainingVideoSlots: Math.min(current.maxVideos, current.remainingVideoSlots + 1),
        }
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
      {embedded ? (
        <div className="tv-studio-embedded-head">
          <div>
            <h2>Profile videos</h2>
            <p>Vertical or square videos • Up to 5 • Approval required</p>
          </div>
          {workspace ? <strong aria-label={`${currentVideoCount} of ${maxVideos} profile video slots used`}>{currentVideoCount}/{maxVideos}</strong> : null}
        </div>
      ) : (
        <div className="tv-studio-head">
          <div>
            <span>Creator tools</span>
            <h2>
              MyDancr TV
              {workspace?.profile ? (
                <>
                  {" — "}
                  <Link href={`/dancers/${encodeURIComponent(workspace.profile.slug)}`}>
                    {workspace.profile.stageName}
                  </Link>
                </>
              ) : " Studio"}
            </h2>
            {workspace?.profile ? (
              <p className="tv-profile-connection">
                Videos published here appear on your public {workspace.profile.stageName} profile.
              </p>
            ) : null}
            <p>Post vertical videos to your real profile. MyDancr TV automatically uses your verified current shift, or your next posted shift, whenever it shows venue context.</p>
          </div>
          <Link href={homeDiscoveryHref("tv")}>Watch MyDancr TV</Link>
        </div>
      )}

      {isLoading ? <p className="tv-studio-status">Loading your real videos…</p> : null}
      {!embedded && !isLoading && workspace && !workspace.profileEligible ? (
        <div className="tv-studio-lock">
          <strong>Profile approval required</strong>
          <p>Your dancer profile must be approved before its moderated videos can appear publicly.</p>
        </div>
      ) : null}
      {workspace?.profileEligible && !workspace.profileVisible ? (
        <div className="tv-studio-incognito">
          <strong>Incognito is on</strong>
          <p>Your approved videos remain saved but are hidden from guests until you turn your profile back on.</p>
        </div>
      ) : null}

      {workspace && atVideoLimit ? (
        <div className="tv-studio-limit" role="status">
          <strong>All {maxVideos} profile video slots are filled</strong>
          <p>Remove a video below before uploading another.</p>
        </div>
      ) : null}

      {workspace && !atVideoLimit ? (
        <section className="tv-upload-form" aria-label="Add profile videos">
          <div className="tv-upload-permissions">
            <strong>Confirm permissions</strong>
          </div>
          <label className="tv-check">
            <input ref={consentInputRef} checked={consentConfirmed} disabled={isSubmitting} type="checkbox" onChange={(event) => setConsentConfirmed(event.target.checked)} />
            <span>I have permission from every identifiable person shown.</span>
          </label>
          <label className="tv-check">
            <input ref={rightsInputRef} checked={rightsConfirmed} disabled={isSubmitting} type="checkbox" onChange={(event) => setRightsConfirmed(event.target.checked)} />
            <span>I own this video or have permission to publish every visual, recording, song, beat, and other audio it contains.</span>
          </label>
          <div className="tv-video-source-grid">
            <input
              ref={libraryInputRef}
              accept="video/mp4,video/webm,video/quicktime,.mov"
              className="tv-video-source-input"
              disabled={isSubmitting}
              multiple
              tabIndex={-1}
              type="file"
              onChange={(event) => {
                queueVideoFiles(Array.from(event.target.files || []), "library");
                event.target.value = "";
              }}
            />
            <button
              aria-disabled={!videoPermissionsConfirmed || isSubmitting}
              aria-label="Choose profile videos from your library"
              className={`tv-video-source-action${!videoPermissionsConfirmed ? " is-awaiting-permissions" : ""}`}
              disabled={isSubmitting}
              type="button"
              onClick={() => openVideoSource(libraryInputRef.current)}
            >
              <span className="tv-video-source-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4z" /><path d="m10 9 5 3-5 3z" /></svg>
              </span>
              <span className="tv-video-source-copy">
                <strong>Video library</strong>
                <small>Choose one or several videos</small>
              </span>
              <span className="tv-video-source-cta" aria-hidden="true">Choose</span>
            </button>
            <input
              ref={cameraInputRef}
              accept="video/*"
              capture="environment"
              className="tv-video-source-input"
              disabled={isSubmitting}
              tabIndex={-1}
              type="file"
              onChange={(event) => {
                queueVideoFiles(Array.from(event.target.files || []), "camera");
                event.target.value = "";
              }}
            />
            <button
              aria-disabled={!videoPermissionsConfirmed || isSubmitting}
              aria-label="Record a new profile video"
              className={`tv-video-source-action${!videoPermissionsConfirmed ? " is-awaiting-permissions" : ""}`}
              disabled={isSubmitting}
              type="button"
              onClick={() => openVideoSource(cameraInputRef.current)}
            >
              <span className="tv-video-source-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 7h11v10H4z" /><path d="m15 10 5-2v8l-5-2z" /></svg>
              </span>
              <span className="tv-video-source-copy">
                <strong>Record video</strong>
                <small>Open your camera now</small>
              </span>
              <span className="tv-video-source-cta" aria-hidden="true">Open</span>
            </button>
          </div>
          <small className="tv-upload-requirements">
            Vertical or square MP4/WebM/MOV · 1–30 seconds each · 75 MB maximum each · {queuedVideos.length} selected · {Math.max(0, maxVideos - currentVideoCount - queuedVideos.length)} slots remaining
          </small>
          {queuedVideos.length ? (
            <div className="tv-upload-queue" aria-label="Video upload progress">
              {queuedVideos.map((item, index) => (
                <article className={`tv-upload-queue-item ${uploadingQueueItemId === item.id ? "is-uploading" : ""}`.trim()} key={item.id}>
                  <video className="tv-upload-preview" muted playsInline preload="metadata" src={item.previewUrl} />
                  <div>
                    <strong>Selected video {index + 1}</strong>
                    <small>{item.stage === "validating" ? "Validating video" : item.stage === "uploading" ? "Uploading securely" : item.stage === "checking" ? "Running automatic review" : item.error ? "Upload failed" : "Waiting to upload"}</small>
                    {item.stage !== "failed" ? <progress aria-label={`Video ${index + 1} upload progress`} max="100" value={item.progress} /> : null}
                    {item.error ? <p>{item.error}</p> : null}
                    <span className="tv-queue-actions">
                      {item.error ? <button disabled={isSubmitting} onClick={() => void uploadVideoBatch([{ ...item, stage: "queued", progress: 0, error: undefined }])} type="button">Retry</button> : null}
                      <button disabled={isSubmitting} onClick={() => removeQueuedVideo(item.id)} type="button">Remove</button>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {!embedded ? (
            <div className="tv-schedule-context-note">
              <strong>Venue context is automatic</strong>
              <span>Working Now takes priority. Otherwise, MyDancr TV shows your next posted shift. With no current or upcoming shift, no venue is shown.</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {status ? <div className="tv-studio-status" role="status" aria-live="polite">{status}</div> : null}

      <section className="tv-video-manager">
        <div className="tv-manager-title">
          <h3>My videos</h3>
          <span>{isLoading ? "…" : `${currentVideoCount}/${maxVideos}`}</span>
        </div>
        <div className="tv-managed-grid">
          {workspace?.videos.map((video) => (
            <article className="tv-managed-video" key={video.id}>
              {video.videoUrl ? <video controls playsInline preload="metadata" src={video.videoUrl} /> : <div className="tv-video-unavailable">Video unavailable</div>}
              <div>
                <span className={`tv-video-status status-${video.status}`}>{statusLabel(video.status)}</span>
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
                {video.status === "approved" && workspace.profileEligible ? <Link href={`/tv/${video.id}`}>Open live video</Link> : null}
                <button type="button" disabled={removingId === video.id} onClick={() => removeVideo(video.id)}>
                  {removingId === video.id ? "Removing…" : "Remove video"}
                </button>
              </div>
            </article>
          ))}
          {!isLoading && workspace && !workspace.videos.length ? <p className="tv-no-videos">No videos submitted yet.</p> : null}
        </div>
      </section>
    </>
  );

  return embedded
    ? <article className="info-panel tv-studio-embedded">{content}</article>
    : <main className="tv-studio-page">{content}</main>;
}

async function readVideoMetadata(file: File) {
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) throw new Error("Upload an MP4, WebM, or MOV video.");
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
      element.onerror = () => reject(new Error("This video could not be read. Try a different MP4, WebM, or MOV file."));
      element.src = url;
    });
    if (
      !Number.isFinite(metadata.duration) ||
      metadata.duration < 1 ||
      metadata.duration > MAX_VIDEO_DURATION_SECONDS
    ) {
      throw new Error("Videos must be between 1 and 30 seconds.");
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
    approved: "Moderation passed",
    rejected: "Not approved",
    hidden: "Removed",
    expired: "Expired",
  } as Record<string, string>)[status] || status;
}

function DancerTvStudioStyles() {
  return (
    <style>{`
      .tv-studio-page { min-height: 100vh; padding: 28px clamp(14px, 4vw, 54px) 60px; background: radial-gradient(circle at 10% 0%, rgba(139,92,246,.22), transparent 26rem), #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .tv-studio-page > * { max-width: 920px; margin-left: auto; margin-right: auto; }
      .tv-studio-embedded { grid-column: 1 / -1; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; }
      .tv-studio-embedded-head { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
      .tv-studio-embedded-head > div { display: grid; gap: 7px; }
      .tv-studio-embedded-head h2 { margin: 0; font-size: 23px; line-height: 1.1; }
      .tv-studio-embedded-head p { margin: 0; max-width: 64ch; color: #b9accd; line-height: 1.5; }
      .tv-studio-embedded-head > strong { min-width: 44px; min-height: 32px; display: grid; place-items: center; border: 1px solid rgba(34,199,255,.25); border-radius: 999px; color: #7eeaff; background: rgba(34,199,255,.08); font-size: 12px; white-space: nowrap; }
      .tv-studio-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
      .tv-studio-head > div { display: grid; gap: 7px; }
      .tv-studio-head span { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .tv-studio-head h2 { margin: 0; font-size: clamp(30px, 5vw, 50px); line-height: 1; }
      .tv-studio-head h2 a { color: #7eeaff; text-decoration-thickness: 2px; text-underline-offset: .12em; }
      .tv-studio-head h2 a:focus-visible { outline: 2px solid #7eeaff; outline-offset: 4px; border-radius: 4px; }
      .tv-studio-head p { margin: 0; max-width: 58ch; color: #b9accd; line-height: 1.5; }
      .tv-studio-head .tv-profile-connection { color: #e2d9ef; font-weight: 800; }
      .tv-studio-head > a, .tv-managed-video a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(34,199,255,.38); border-radius: 999px; color: #fff; background: rgba(34,199,255,.08); font-weight: 900; text-decoration: none; white-space: nowrap; }
      .tv-upload-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; padding: 18px; border: 1px solid rgba(139,92,246,.3); border-radius: 12px; background: rgba(11,11,16,.84); }
      .tv-upload-form > label { min-width: 0; display: grid; align-content: start; gap: 7px; color: #ddd4ed; font-size: 13px; font-weight: 850; }
      .tv-upload-permissions, .tv-video-source-grid, .tv-upload-requirements, .tv-upload-queue { min-width: 0; max-width: 100%; grid-column: 1 / -1; }
      .tv-upload-permissions { display: grid; gap: 4px; }
      .tv-upload-permissions strong { color: #fff; font-size: 14px; }
      .tv-video-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 10px; }
      .tv-video-source-action { position: relative; min-width: 0; min-height: 74px; height: 100%; display: grid; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 9px; overflow: hidden; padding: 10px; border: 1px solid rgba(126,234,255,.2); border-radius: 12px; color: #f8f5fb; background: linear-gradient(145deg,rgba(124,58,237,.13),rgba(34,199,255,.055)); box-sizing: border-box; cursor: pointer; appearance: none; -webkit-tap-highlight-color: transparent; text-align: left; font: inherit; }
      .tv-video-source-action:hover { border-color: rgba(126,234,255,.42); background: linear-gradient(145deg,rgba(124,58,237,.2),rgba(34,199,255,.09)); }
      .tv-video-source-action:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .tv-video-source-action.is-awaiting-permissions { opacity: .72; }
      .tv-video-source-action:disabled { opacity: .5; cursor: progress; }
      .tv-video-source-input { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); opacity: 0; pointer-events: none; }
      .tv-video-source-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; color: #8beafa; background: rgba(34,199,255,.09); }
      .tv-video-source-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .tv-video-source-copy { min-width: 0; display: grid; gap: 2px; }
      .tv-video-source-copy strong { color: #fff; font-size: 13px; }
      .tv-video-source-copy small { color: #aaa2b4; font-size: 10px; line-height: 1.3; }
      .tv-video-source-cta { min-width: 60px; display: grid; place-items: center; padding: 5px 7px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #b8effa; background: rgba(34,199,255,.07); box-sizing: border-box; font-size: 9px; font-weight: 950; text-transform: uppercase; }
      .tv-upload-form small { color: #9f94b3; font-size: 11px; font-weight: 700; }
      .tv-upload-requirements { display: block; }
      .tv-upload-queue { display: grid; gap: 10px; }
      .tv-upload-queue-item { min-width: 0; display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid rgba(251,191,36,.38); border-radius: 10px; background: rgba(251,191,36,.07); }
      .tv-upload-queue-item.is-uploading { border-color: rgba(34,211,238,.58); box-shadow: inset 3px 0 0 rgba(34,211,238,.8); }
      .tv-upload-preview { width: 96px; aspect-ratio: 9 / 16; max-height: 170px; object-fit: contain; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #000; }
      .tv-upload-queue-item > div { min-width: 0; display: grid; align-content: start; gap: 6px; }
      .tv-upload-queue-item progress { width: 100%; height: 7px; accent-color: #7eeaff; }
      .tv-upload-queue-item p { margin: 0; color: #fca5a5; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
      .tv-upload-queue-item button { width: fit-content; min-height: 36px; padding: 0 12px; border: 1px solid rgba(239,68,68,.36); border-radius: 8px; color: #fecaca; background: rgba(239,68,68,.12); font-weight: 850; cursor: pointer; }
      .tv-queue-actions { display: flex; flex-wrap: wrap; gap: 7px; }
      .tv-queue-actions button:first-child:not(:last-child) { border-color: rgba(34,211,238,.36); color: #b5f1ff; background: rgba(34,211,238,.1); }
      .tv-check { grid-column: 1 / -1; grid-template-columns: 20px minmax(0, 1fr) !important; align-items: start; }
      .tv-check input { width: 18px; height: 18px; }
      .tv-schedule-context-note { grid-column: 1 / -1; display: grid; gap: 4px; padding: 12px; border: 1px solid rgba(34,199,255,.22); border-radius: 8px; background: rgba(34,199,255,.07); }
      .tv-schedule-context-note span { color: #a9dce8; font-size: 12px; line-height: 1.45; }
      .tv-studio-status, .tv-studio-lock, .tv-studio-incognito, .tv-studio-limit { margin-top: 12px; padding: 12px 14px; border: 1px solid rgba(34,199,255,.24); border-radius: 8px; background: rgba(34,199,255,.07); color: #b5f1ff; line-height: 1.5; }
      .tv-studio-lock, .tv-studio-incognito, .tv-studio-limit { display: grid; gap: 4px; }
      .tv-studio-lock p, .tv-studio-incognito p, .tv-studio-limit p { margin: 0; color: #cfc5de; }
      .tv-studio-incognito { border-color: rgba(255,200,90,.3); background: rgba(255,200,90,.07); color: #ffe19d; }
      .tv-video-manager { width: 100%; max-width: 100%; min-width: 0; margin-top: 22px; display: grid; gap: 12px; box-sizing: border-box; }
      .tv-manager-title { display: flex; align-items: center; justify-content: space-between; }
      .tv-manager-title h3 { margin: 0; font-size: 23px; }
      .tv-manager-title span { min-width: 34px; min-height: 28px; display: grid; place-items: center; border-radius: 999px; color: #7eeaff; background: rgba(34,199,255,.09); font-weight: 900; }
      .tv-managed-grid { width: 100%; max-width: 100%; min-width: 0; display: grid; gap: 12px; box-sizing: border-box; }
      .tv-managed-video { width: 100%; max-width: 100%; min-width: 0; display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 13px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; background: rgba(11,11,16,.82); box-sizing: border-box; overflow: hidden; }
      .tv-managed-video > video, .tv-video-unavailable { width: 180px; aspect-ratio: 9 / 16; max-height: 310px; object-fit: contain; border-radius: 8px; background: #000; }
      .tv-video-unavailable { display: grid; place-items: center; color: #9f94b3; font-size: 12px; }
      .tv-managed-video > div { width: 100%; max-width: 100%; min-width: 0; display: grid; align-content: start; gap: 8px; box-sizing: border-box; }
      .tv-managed-video small { max-width: 100%; color: #a99ebc; overflow-wrap: anywhere; }
      .tv-managed-video p { max-width: 100%; margin: 0; padding: 9px; border: 1px solid rgba(255,91,116,.22); border-radius: 8px; color: #ffc2cc; background: rgba(255,91,116,.06); box-sizing: border-box; overflow-wrap: anywhere; }
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
        .tv-studio-embedded-head { gap: 10px; }
        .tv-upload-form { grid-template-columns: 1fr; padding: 12px; }
        .tv-upload-form > * { grid-column: auto !important; }
        .tv-video-source-grid { grid-template-columns: 1fr; }
        .tv-managed-video { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 10px; }
        .tv-managed-video > video, .tv-video-unavailable { width: min(100%, 240px); max-height: 420px; justify-self: center; }
        .tv-managed-video dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .tv-managed-video > div > a, .tv-managed-video > div > button { width: 100%; justify-self: stretch; box-sizing: border-box; }
      }
    `}</style>
  );
}
