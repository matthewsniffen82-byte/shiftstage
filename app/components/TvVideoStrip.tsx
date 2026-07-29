"use client";

import { useEffect, useRef, useState } from "react";
import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

export function TvVideoStrip({
  title,
  videos,
  showDancerName = true,
}: {
  title: string;
  videos: MyDancrTvVideo[];
  showDancerName?: boolean;
}) {
  const [activeVideo, setActiveVideo] = useState<MyDancrTvVideo | null>(null);
  const [viewerStatus, setViewerStatus] = useState("");
  const [viewerPaused, setViewerPaused] = useState(false);
  const [viewerMuted, setViewerMuted] = useState(false);
  const viewerVideo = useRef<HTMLVideoElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeHandled = useRef(false);
  const activeIndex = activeVideo
    ? videos.findIndex((video) => video.id === activeVideo.id)
    : -1;

  useEffect(() => {
    if (!activeVideo) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const showKeyboardVideo = (direction: -1 | 1) => {
      setActiveVideo((current) => {
        if (!current) return current;
        const currentIndex = videos.findIndex((video) => video.id === current.id);
        return videos[currentIndex + direction] || current;
      });
      setViewerStatus("");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveVideo(null);
      if (event.key === "ArrowLeft") showKeyboardVideo(-1);
      if (event.key === "ArrowRight") showKeyboardVideo(1);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeVideo, videos]);

  function showRelativeVideo(direction: -1 | 1) {
    setActiveVideo((current) => {
      if (!current) return current;
      const currentIndex = videos.findIndex((video) => video.id === current.id);
      const nextIndex = currentIndex + direction;
      return videos[nextIndex] || current;
    });
    setViewerStatus("");
  }

  async function toggleViewerPlayback() {
    const video = viewerVideo.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setViewerStatus("Tap Play again to start this video.");
      }
      return;
    }
    video.pause();
  }

  function toggleViewerSound() {
    const video = viewerVideo.current;
    if (!video) return;
    const muted = !video.muted;
    video.muted = muted;
    setViewerMuted(muted);
  }

  function finishVideoSwipe(clientX: number) {
    if (swipeStartX.current === null) return;
    const distance = clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(distance) < 50) return;
    swipeHandled.current = true;
    showRelativeVideo(distance < 0 ? 1 : -1);
  }

  async function shareVideo(video: MyDancrTvVideo) {
    const url = new URL(`/tv/${encodeURIComponent(video.id)}`, window.location.origin).toString();
    setViewerStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${video.dancer.stageName} on MyDancr TV`,
          text: `Watch ${video.dancer.stageName} on MyDancr TV.`,
          url,
        });
        setViewerStatus("Video shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setViewerStatus("Video link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setViewerStatus("Unable to share this video.");
    }
  }

  function playPreview(card: HTMLButtonElement) {
    const preview = card.querySelector("video");
    if (!preview) return;
    void preview.play().catch(() => undefined);
  }

  function pausePreview(card: HTMLButtonElement) {
    card.querySelector("video")?.pause();
  }

  if (!videos.length) return null;

  return (
    <section
      aria-label={title}
      className="tv-video-strip"
      data-video-count={Math.min(videos.length, 4)}
    >
      <TvVideoStripStyles />
      <div className="tv-strip-head">
        <div>
          <span>MyDancr TV</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="tv-strip-list">
        {videos.map((video, index) => {
          const schedule = tvProfileShiftLabel(video);
          const videoPosition = `Video ${index + 1} of ${videos.length}`;
          const videoMetadata = `${videoPosition} · ${formatVideoDuration(video.durationSeconds)} · ${formatVideoDate(video.publishedAt)}`;
          return (
            <button
              aria-label={`Open ${video.dancer.stageName} MyDancr TV ${videoPosition} full screen, ${schedule.label}, ${formatVideoDuration(video.durationSeconds)}`}
              className="tv-strip-card"
              key={video.id}
              type="button"
              onBlur={(event) => pausePreview(event.currentTarget)}
              onClick={() => {
                setViewerStatus("");
                setViewerPaused(false);
                setViewerMuted(false);
                setActiveVideo(video);
              }}
              onFocus={(event) => playPreview(event.currentTarget)}
              onMouseEnter={(event) => playPreview(event.currentTarget)}
              onMouseLeave={(event) => pausePreview(event.currentTarget)}
            >
              <video aria-hidden="true" loop muted playsInline preload="metadata" src={video.videoUrl} />
              <div>
                {showDancerName ? <strong>{video.dancer.stageName}</strong> : null}
                <span className={`tv-strip-schedule ${schedule.className}`}>{schedule.label}</span>
                <span className="tv-strip-meta">{videoMetadata}</span>
                <span className="tv-strip-open">Open full screen</span>
              </div>
            </button>
          );
        })}
      </div>
      {activeVideo ? (
        <div
          className="tv-video-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeVideo.dancer.stageName} MyDancr TV video`}
          onClick={(event) => {
            if (event.currentTarget === event.target) setActiveVideo(null);
          }}
        >
          <div className="tv-video-viewer-shell">
            <button
              className="tv-video-viewer-close"
              type="button"
              aria-label="Close full-screen video"
              ref={closeButton}
              onClick={() => setActiveVideo(null)}
            >
              ×
            </button>
            <div
              className="tv-video-viewer-stage"
              onTouchStart={(event) => {
                swipeHandled.current = false;
                if (event.touches.length !== 1) {
                  swipeStartX.current = null;
                  return;
                }
                swipeStartX.current = event.changedTouches[0]?.clientX ?? null;
              }}
              onTouchMove={(event) => {
                if (event.touches.length !== 1) swipeStartX.current = null;
              }}
              onTouchEnd={(event) => {
                finishVideoSwipe(event.changedTouches[0]?.clientX ?? 0);
              }}
            >
              <video
                key={activeVideo.id}
                autoPlay
                controlsList="nofullscreen noremoteplayback nodownload"
                disablePictureInPicture
                loop
                muted={viewerMuted}
                playsInline
                preload="auto"
                ref={viewerVideo}
                src={activeVideo.videoUrl}
                onClick={() => {
                  if (swipeHandled.current) {
                    swipeHandled.current = false;
                    return;
                  }
                  void toggleViewerPlayback();
                }}
                onDoubleClick={(event) => event.preventDefault()}
                onPause={() => setViewerPaused(true)}
                onPlay={() => setViewerPaused(false)}
              />
              <button
                className="tv-video-viewer-previous"
                type="button"
                aria-label="Previous dancer video"
                disabled={activeIndex <= 0}
                onClick={() => showRelativeVideo(-1)}
              >
                ‹
              </button>
              <button
                className="tv-video-viewer-next"
                type="button"
                aria-label="Next dancer video"
                disabled={activeIndex >= videos.length - 1}
                onClick={() => showRelativeVideo(1)}
              >
                ›
              </button>
            </div>
            <div className="tv-video-viewer-footer">
              <div>
                <strong>{activeVideo.dancer.stageName}</strong>
                <span>{tvProfileShiftLabel(activeVideo).label} · Video {activeIndex + 1} of {videos.length}</span>
              </div>
              <div className="tv-video-viewer-actions">
                <button type="button" onClick={toggleViewerPlayback}>
                  {viewerPaused ? "Play" : "Pause"}
                </button>
                <button type="button" onClick={toggleViewerSound}>
                  {viewerMuted ? "Sound on" : "Sound off"}
                </button>
                <button type="button" onClick={() => shareVideo(activeVideo)}>Share</button>
              </div>
              <p aria-live="polite">{viewerStatus}</p>
              <div className="tv-video-viewer-gallery" aria-label={`${activeVideo.dancer.stageName} videos`}>
                {videos.map((video, index) => (
                  <button
                    className={video.id === activeVideo.id ? "active" : ""}
                    type="button"
                    key={video.id}
                    aria-current={video.id === activeVideo.id ? "true" : undefined}
                    aria-label={`Open video ${index + 1} of ${videos.length}`}
                    onClick={() => {
                      setViewerStatus("");
                      setViewerPaused(false);
                      setActiveVideo(video);
                    }}
                  >
                    <video aria-hidden="true" muted playsInline preload="metadata" src={video.videoUrl} />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function tvProfileShiftLabel(video: MyDancrTvVideo) {
  if (video.shift?.isActive) {
    return { className: "is-now", label: "Working now" };
  }
  if (video.shift) {
    return {
      className: "is-upcoming",
      label: formatTvProfileShift(video.shift.startsAt, video.shift.timezone),
    };
  }
  return { className: "is-no-shift", label: "No shift posted" };
}

function formatTvProfileShift(startsAt: string, timeZone: string) {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "UTC",
    }).format(date).replace(",", "").replace(", ", " · ");
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date).replace(",", "").replace(", ", " · ");
  }
}

function formatVideoDuration(durationSeconds: number) {
  const seconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatVideoDate(publishedAt: string) {
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return "Published";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function TvVideoStripStyles() {
  return (
    <style>{`
      .tv-video-strip { max-width: 1120px; margin: 22px auto 0; display: grid; gap: 12px; }
      .tv-strip-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .tv-strip-head > div { display: grid; gap: 5px; }
      .tv-strip-head span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .tv-strip-head h2 { margin: 0; font-size: clamp(22px, 4vw, 34px); }
      .tv-strip-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 240px); gap: 10px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x proximity; padding-bottom: 4px; }
      .tv-strip-card { position: relative; min-height: 330px; padding: 0; overflow: hidden; border: 1px solid rgba(139,92,246,.3); border-radius: 10px; color: #fff; background: #08080b; font: inherit; text-align: left; scroll-snap-align: start; cursor: pointer; }
      .tv-strip-card:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .tv-strip-card video { width: 100%; height: 100%; min-height: 330px; display: block; object-fit: cover; background: #000; }
      .tv-strip-card::after { content: ""; position: absolute; inset: 42% 0 0; background: linear-gradient(180deg, transparent, rgba(0,0,0,.92)); }
      .tv-strip-card > div { position: absolute; z-index: 2; left: 12px; right: 12px; bottom: 12px; display: grid; gap: 5px; }
      .tv-strip-card strong { overflow: hidden; color: #fff; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 2px 8px rgba(0,0,0,.9); }
      .tv-strip-schedule { width: fit-content; max-width: 100%; padding: 4px 7px; overflow: hidden; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #b8b2c4; background: rgba(7,7,12,.76); font-size: 10px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .tv-strip-schedule.is-now { border-color: rgba(77,236,157,.38); color: #80f3b6; background: rgba(31,143,87,.24); }
      .tv-strip-schedule.is-upcoming { border-color: rgba(126,234,255,.32); color: #9fefff; background: rgba(34,199,255,.16); }
      .tv-strip-meta { overflow: hidden; color: #d5cedf; font-size: 9px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
      .tv-strip-open { width: fit-content; color: #fff; font-size: 10px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
      .tv-video-viewer { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 0; overscroll-behavior: none; touch-action: none; background: rgba(0,0,0,.96); backdrop-filter: blur(18px); }
      .tv-video-viewer-shell { position: relative; width: 100%; max-width: none; height: 100%; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; border: 0; border-radius: 0; background: #000; box-shadow: none; overscroll-behavior: none; touch-action: none; }
      .tv-video-viewer-stage { position: relative; min-height: 0; overflow: hidden; overscroll-behavior: none; touch-action: none; }
      .tv-video-viewer-stage > video { width: 100%; height: 100%; min-height: 0; display: block; object-fit: contain; background: #000; touch-action: none; user-select: none; -webkit-user-select: none; }
      .tv-video-viewer-close { position: absolute; z-index: 3; top: 12px; right: 12px; width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.28); border-radius: 50%; color: #fff; background: rgba(0,0,0,.72); font-size: 28px; line-height: 1; cursor: pointer; }
      .tv-video-viewer-previous, .tv-video-viewer-next { position: absolute; z-index: 2; top: 50%; width: 46px; height: 54px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(0,0,0,.62); font-size: 34px; line-height: 1; transform: translateY(-50%); cursor: pointer; }
      .tv-video-viewer-previous { left: 12px; }
      .tv-video-viewer-next { right: 12px; }
      .tv-video-viewer-previous:disabled, .tv-video-viewer-next:disabled { opacity: .28; cursor: default; }
      .tv-video-viewer-footer { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 14px; padding: 13px 14px calc(13px + env(safe-area-inset-bottom)); border-top: 1px solid rgba(255,255,255,.1); background: #09090d; }
      .tv-video-viewer-footer > div:first-child { min-width: 0; display: grid; gap: 3px; }
      .tv-video-viewer-footer strong { overflow: hidden; color: #fff; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
      .tv-video-viewer-footer span { color: #9fefff; font-size: 11px; font-weight: 850; }
      .tv-video-viewer-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .tv-video-viewer-actions button { min-height: 42px; padding: 0 14px; border: 1px solid rgba(126,234,255,.34); border-radius: 999px; color: #fff; background: rgba(34,199,255,.12); font-weight: 900; cursor: pointer; }
      .tv-video-viewer-footer p { min-height: 16px; grid-column: 1 / -1; margin: 0; color: #a7f3d0; font-size: 11px; font-weight: 800; }
      .tv-video-viewer-gallery { grid-column: 1 / -1; display: grid; grid-auto-flow: column; grid-auto-columns: 72px; gap: 8px; padding-bottom: 3px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x proximity; }
      .tv-video-viewer-gallery button { position: relative; width: 72px; height: 78px; padding: 0; overflow: hidden; border: 2px solid transparent; border-radius: 9px; background: #000; scroll-snap-align: center; cursor: pointer; }
      .tv-video-viewer-gallery button.active { border-color: #7eeaff; box-shadow: 0 0 14px rgba(126,234,255,.28); }
      .tv-video-viewer-gallery video { width: 100%; height: 100%; display: block; object-fit: cover; pointer-events: none; }
      .tv-video-viewer-gallery span { position: absolute; right: 4px; bottom: 4px; min-width: 20px; height: 20px; display: grid; place-items: center; border-radius: 999px; color: #fff; background: rgba(0,0,0,.76); font-size: 10px; font-weight: 950; }
      @media (max-width: 620px) {
        .tv-strip-list { grid-auto-columns: minmax(150px, 42vw); }
        .tv-strip-card, .tv-strip-card video { min-height: 270px; }
        .tv-video-viewer-footer { grid-template-columns: minmax(0, 1fr); }
      }
    `}</style>
  );
}
