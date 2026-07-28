"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

const SESSION_KEY = "dancrAuthSessionV1";
const VIEWER_SESSION_KEY = "mydancrTvViewerSessionV1";
const FILTERS = [
  { value: "for-you", label: "For You" },
  { value: "following", label: "Following" },
  { value: "tonight", label: "Tonight" },
] as const;

type TvSource = "tv_feed" | "shared_link";

export default function TvFeedClient({
  initialCity,
  initialFilter,
  initialSelectedVideoId,
  initialVideos,
  source,
}: {
  initialCity: string;
  initialFilter: string;
  initialSelectedVideoId: string;
  initialVideos: MyDancrTvVideo[];
  source: TvSource;
}) {
  const [videos, setVideos] = useState(initialVideos);
  const city = initialCity;
  const [filter, setFilter] = useState(
    FILTERS.some((item) => item.value === initialFilter) ? initialFilter : "for-you",
  );
  const [activeVideoId, setActiveVideoId] = useState(initialSelectedVideoId || initialVideos[0]?.id || "");
  const [muted, setMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [accountLabel, setAccountLabel] = useState("Login / Join");
  const feedElement = useRef<HTMLElement | null>(null);
  const videoElements = useRef<Record<string, HTMLVideoElement | null>>({});
  const engagedTimers = useRef<Record<string, number>>({});
  const completedVideos = useRef(new Set<string>());
  const loadedAuthenticatedFeed = useRef(false);
  const viewerSessionId = useMemo(readViewerSessionId, []);

  const trackEvent = useCallback((videoId: string, eventType: string) => {
    const token = readAnyToken();
    fetch(`/api/public/tv/${videoId}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ eventType, sessionId: viewerSessionId, source }),
      keepalive: true,
    }).catch(() => null);
  }, [source, viewerSessionId]);

  const loadFeed = useCallback(async (nextFilter: string, nextCity: string, selectedVideoId = "") => {
    setIsLoading(true);
    setStatus("");
    try {
      const token = readCustomerToken();
      const params = new URLSearchParams({
        city: nextCity,
        filter: nextFilter,
        limit: "18",
      });
      if (selectedVideoId) params.set("video", selectedVideoId);
      const response = await fetch(`/api/public/tv?${params.toString()}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load MyDancr TV.");
      const cityVideos = Array.isArray(data.videos)
        ? data.videos.filter(
            (video: MyDancrTvVideo) => tvCitiesMatch(video.dancer.city, nextCity),
          )
        : [];
      setVideos(cityVideos);
      setActiveVideoId(cityVideos[0]?.id || "");
      if (data.requiresAccount) setStatus("Sign in to see videos from dancers you follow.");
      const url = new URL(window.location.href);
      url.pathname = "/tv";
      url.searchParams.set("city", nextCity);
      url.searchParams.set("filter", nextFilter);
      url.searchParams.delete("video");
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load MyDancr TV.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = readSession();
    if (session?.account?.role) setAccountLabel("Account");
  }, []);

  useEffect(() => {
    if (initialFilter !== "following" || loadedAuthenticatedFeed.current) return;
    loadedAuthenticatedFeed.current = true;
    loadFeed("following", initialCity, initialSelectedVideoId);
  }, [initialCity, initialFilter, initialSelectedVideoId, loadFeed]);

  useEffect(() => {
    const feed = feedElement.current;
    if (!feed) return;
    feed.scrollTop = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible || visible.intersectionRatio < 0.75) return;
        const videoId = (visible.target as HTMLElement).dataset.videoId || "";
        if (videoId) setActiveVideoId(videoId);
      },
      { root: feed, threshold: [0.75, 0.9] },
    );
    feed.querySelectorAll<HTMLElement>("[data-tv-slide]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [videos]);

  useEffect(() => {
    Object.entries(videoElements.current).forEach(([videoId, element]) => {
      if (!element) return;
      element.muted = muted;
      if (videoId === activeVideoId) {
        element.play().catch(() => null);
        trackEvent(videoId, "impression");
        window.clearTimeout(engagedTimers.current[videoId]);
        engagedTimers.current[videoId] = window.setTimeout(() => {
          if (!element.paused) trackEvent(videoId, "engaged_view");
        }, 3000);
      } else {
        element.pause();
        window.clearTimeout(engagedTimers.current[videoId]);
      }
    });
  }, [activeVideoId, muted, trackEvent]);

  useEffect(() => () => {
    Object.values(engagedTimers.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  function changeFilter(nextFilter: string) {
    if (nextFilter === filter && videos.length) return;
    setFilter(nextFilter);
    loadFeed(nextFilter, city);
  }

  return (
    <main className="tv-shell">
      <TvStyles />
      <header className="tv-global-header">
        <div className="tv-global-topbar">
          <Link className="tv-global-logo" href="/" aria-label="Go to Mydancr home">
            <span aria-hidden="true">mydanc<em>r</em></span>
          </Link>
          <Link className="tv-global-search" href="/#discoveryTabs" aria-label="Search dancers, clubs, and cities">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span>Search dancers, clubs, cities...</span>
          </Link>
          <Link className="tv-global-account" href="/account">{accountLabel}</Link>
          <Link
            className="tv-close"
            href="/"
            aria-label="Close MyDancr TV and return to homepage"
          >
            ×
          </Link>
        </div>
        <nav className="tv-site-nav" aria-label="Primary">
          <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Now</Link>
          <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link>
          <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
          <Link href={`/trending?city=${encodeURIComponent(city)}`}>Trending</Link>
          <Link className="active" href={`/tv?city=${encodeURIComponent(city)}`}>MyDancr TV</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <header className="tv-header">
        <div>
          <span>Watch. Discover. Go.</span>
          <h1>MyDancr TV {myDancrTvCityLabel(city)}</h1>
        </div>
      </header>

      <nav className="tv-filters" aria-label="MyDancr TV feeds">
        {FILTERS.map((item) => (
          <button
            className={filter === item.value ? "active" : ""}
            type="button"
            key={item.value}
            aria-current={filter === item.value ? "page" : undefined}
            onClick={() => changeFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="tv-feedback" aria-live="polite">
        {status ? <div className="tv-status" role="status">{status}</div> : null}
        {isLoading ? <div className="tv-loading" role="status">Loading real MyDancr TV videos…</div> : null}
      </div>

      {!isLoading && !videos.length ? (
        <section className="tv-empty">
          <strong>{filter === "following" ? "No followed dancer videos yet." : `No approved videos in ${city} yet.`}</strong>
          <p>
            {filter === "following"
              ? "Follow dancers to build this feed, or explore approved videos."
              : "Videos appear here only after dancer and administrator approval."}
          </p>
          <div>
            {filter === "following" ? <button type="button" onClick={() => changeFilter("for-you")}>Explore videos</button> : null}
            <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Browse dancers</Link>
          </div>
        </section>
      ) : null}

      <section ref={feedElement} className="tv-feed" aria-label="MyDancr TV videos">
        {videos.map((video) => (
          <article
            className="tv-slide"
            data-tv-slide
            data-video-id={video.id}
            data-tv-slide-key={video.id}
            key={video.id}
          >
            <div className="tv-player">
              <Link
                className="tv-profile-card"
                href={dancerProfileHref(video)}
                aria-label={`Open ${video.dancer.stageName}'s live profile`}
                onClick={() => trackEvent(video.id, "profile_click")}
              >
                <video
                  ref={(element) => {
                    videoElements.current[video.id] = element;
                  }}
                  aria-label={`${video.dancer.stageName} MyDancr TV video`}
                  loop
                  muted={muted}
                  playsInline
                  preload={video.id === activeVideoId ? "auto" : "metadata"}
                  src={video.videoUrl}
                  onTimeUpdate={(event) => {
                    const element = event.currentTarget;
                    if (
                      element.duration > 0 &&
                      element.currentTime / element.duration >= 0.95 &&
                      !completedVideos.current.has(video.id)
                    ) {
                      completedVideos.current.add(video.id);
                      trackEvent(video.id, "completed");
                    }
                  }}
                />
                <div className="tv-player-shade" />
                <div className="tv-profile-body">
                  <div className="tv-card-info-stack">
                    <h2>
                      <span className="tv-card-stage-name">{video.dancer.stageName}</span>
                      <span className="tv-verified-mark" aria-label="Verified">✓</span>
                    </h2>
                    {video.venue ? (
                      <div className="tv-card-venue-line">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                          <circle cx="12" cy="10" r="2.5" />
                        </svg>
                        <span className="tv-card-venue-name">{video.venue.name}</span>
                      </div>
                    ) : null}
                  </div>
                  {video.shift ? (
                    <div className={video.shift.isActive ? "tv-schedule-row is-tonight" : "tv-schedule-row is-upcoming"}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                      <span className={video.shift.isActive ? "tv-card-schedule-text tonight" : "tv-card-schedule-text upcoming"}>
                        {video.shift.isActive
                          ? "Working now"
                          : `Upcoming ${formatShift(video.shift.startsAt, video.shift.timezone)}`}
                      </span>
                    </div>
                  ) : (
                    <div className="tv-no-shifts-state">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                      </svg>
                      <span>No upcoming shifts</span>
                    </div>
                  )}
                </div>
              </Link>
              <button
                className="tv-sound"
                type="button"
                aria-label={muted ? "Turn sound on" : "Mute video"}
                onClick={() => setMuted((value) => !value)}
              >
                {muted ? "Sound off" : "Sound on"}
              </button>
            </div>
          </article>
        ))}
      </section>

      <nav className="tv-mobile-nav" aria-label="Mobile primary navigation">
        <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Now</Link>
        <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link>
        <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
        <Link href={`/trending?city=${encodeURIComponent(city)}`}>Trending</Link>
      </nav>

    </main>
  );
}

function readSession() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function myDancrTvCityLabel(city: string) {
  return city.trim() || "Las Vegas";
}

function tvCitiesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function dancerProfileHref(video: MyDancrTvVideo) {
  return `/dancers/${encodeURIComponent(video.dancer.slug)}`;
}

function readCustomerToken() {
  const session = readSession();
  return session?.account?.role === "customer" && typeof session?.accessToken === "string"
    ? session.accessToken
    : "";
}

function readAnyToken() {
  const session = readSession();
  return typeof session?.accessToken === "string" ? session.accessToken : "";
}

function readViewerSessionId() {
  if (typeof window === "undefined") return "server-render";
  const existing = window.localStorage.getItem(VIEWER_SESSION_KEY);
  if (existing && existing.length >= 8) return existing;
  const id = window.crypto.randomUUID();
  window.localStorage.setItem(VIEWER_SESSION_KEY, id);
  return id;
}

function formatShift(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function TvStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }
      body { margin: 0; background: radial-gradient(circle at 78% 0%, rgba(155,92,255,.16), transparent 32rem), radial-gradient(circle at 14% 10%, rgba(139,61,255,.1), transparent 24rem), #030304; color: #f8f5ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input { font: inherit; }
      .tv-shell { width: min(100%, 1440px); height: 100svh; height: 100dvh; min-height: 0; margin: 0 auto; padding: 0 clamp(14px, 3vw, 44px) max(12px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; overflow: hidden; border-inline: 1px solid rgba(53,216,255,.1); background: radial-gradient(circle at 12% 0%, rgba(139,92,246,.22), transparent 25rem), radial-gradient(circle at 92% 6%, rgba(34,199,255,.12), transparent 25rem), #030305; box-shadow: 0 40px 120px rgba(0,0,0,.7); }
      .tv-global-header { position: relative; flex: 0 0 auto; z-index: 40; margin: 0 calc(-1 * clamp(14px, 3vw, 44px)) 14px; padding: 16px clamp(14px, 3vw, 44px) 12px; border-bottom: 1px solid rgba(53,216,255,.12); background: rgba(3,3,4,.88); box-shadow: 0 12px 34px rgba(0,0,0,.58); backdrop-filter: blur(22px); }
      .tv-global-topbar { display: flex; align-items: center; gap: 18px; }
      .tv-global-logo { width: min(34vw, 236px); min-width: 196px; aspect-ratio: 331 / 103; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(148,68,255,.72); border-radius: 15px; color: #fff; background: #050507; box-shadow: 0 0 18px rgba(132,50,255,.24), inset 0 0 16px rgba(132,50,255,.08); text-decoration: none; }
      .tv-global-logo span { color: #fff; font-size: clamp(38px, 5.7vw, 50px); font-weight: 950; letter-spacing: -.065em; line-height: .9; text-transform: lowercase; text-shadow: 0 0 12px rgba(255,255,255,.7), 0 0 22px rgba(255,255,255,.28); transform: translateY(-1px); }
      .tv-global-logo em { color: #a855ff; font-style: normal; text-shadow: 0 0 10px rgba(168,85,255,.96), 0 0 24px rgba(139,92,246,.78), 0 0 42px rgba(124,58,237,.52); }
      .tv-global-search { width: min(520px, 34vw); min-height: 56px; display: flex; align-items: center; gap: 13px; padding: 0 18px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #7f758c; background: rgba(12,12,15,.84); box-shadow: inset 0 0 18px rgba(255,255,255,.025), 0 10px 30px rgba(0,0,0,.32); text-decoration: none; }
      .tv-global-search svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; flex: 0 0 auto; }
      .tv-global-search span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .tv-global-account { min-width: 108px; min-height: 46px; margin-left: auto; display: inline-flex; align-items: center; justify-content: center; padding: 0 17px; border: 1px solid rgba(236,72,153,.42); border-radius: 999px; color: #fff; background: rgba(9,9,15,.88); box-shadow: 0 0 22px rgba(124,58,237,.18), inset 0 1px 0 rgba(255,255,255,.04); font-size: 13px; font-weight: 900; text-decoration: none; white-space: nowrap; }
      .tv-close { width: 46px; height: 46px; flex: 0 0 46px; display: grid; place-items: center; border: 1px solid rgba(53,216,255,.46); border-radius: 50%; color: #fff; background: rgba(5,5,9,.9); box-shadow: 0 0 22px rgba(53,216,255,.14); font-size: 28px; line-height: 1; text-decoration: none; }
      .tv-global-logo:focus-visible, .tv-global-search:focus-visible, .tv-global-account:focus-visible, .tv-close:focus-visible { outline: 2px solid rgba(192,132,255,.72); outline-offset: 3px; }
      .tv-site-nav { max-width: 1180px; min-height: 40px; margin: 12px auto 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 7px; }
      .tv-site-nav a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; color: #d8d0e8; background: rgba(255,255,255,.035); font-size: 13px; font-weight: 850; text-decoration: none; }
      .tv-site-nav a.active { color: #fff; border-color: rgba(34,199,255,.5); background: linear-gradient(135deg, rgba(109,40,217,.35), rgba(34,199,255,.14)); box-shadow: 0 0 20px rgba(34,199,255,.1); }
      .tv-header { width: 100%; max-width: 1000px; flex: 0 0 auto; margin: 0 auto 12px; display: flex; justify-content: space-between; align-items: end; gap: 18px; }
      .tv-header > div { display: grid; gap: 2px; }
      .tv-header span, .tv-kicker { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .18em; text-transform: uppercase; }
      .tv-header h1 { margin: 0; font-size: clamp(34px, 6vw, 62px); line-height: 1; }
      .tv-filters { position: relative; flex: 0 0 auto; z-index: 20; width: 100%; max-width: 1000px; margin: 0 auto 12px; padding: 8px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(5,5,8,.9); backdrop-filter: blur(16px); }
      .tv-filters button { min-height: 42px; border: 1px solid transparent; border-radius: 8px; color: #a99ebc; background: transparent; font-weight: 900; cursor: pointer; }
      .tv-filters button.active { color: #fff; border-color: rgba(139,92,246,.44); background: linear-gradient(135deg, rgba(109,40,217,.34), rgba(34,199,255,.12)); }
      .tv-feedback { position: relative; z-index: 30; width: 100%; max-width: 1000px; height: 0; flex: 0 0 0; margin: 0 auto; pointer-events: none; }
      .tv-status, .tv-loading { position: absolute; top: 6px; left: 0; right: 0; margin: 0; padding: 10px 14px; border: 1px solid rgba(34,199,255,.2); border-radius: 8px; background: rgba(5,17,22,.94); box-shadow: 0 10px 28px rgba(0,0,0,.48); color: #a9efff; font-size: 13px; font-weight: 800; }
      .tv-feed { width: 100%; max-width: 1000px; height: auto; min-height: 0; flex: 1 1 0; margin: 0 auto; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; overflow-anchor: none; touch-action: pan-y; scroll-snap-type: y mandatory; scroll-padding-block: 0; scroll-behavior: smooth; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(139,92,246,.48) transparent; }
      .tv-slide { height: 100%; min-height: 100%; max-height: 100%; padding: 8px 0; display: grid; place-items: center; overflow: hidden; contain: layout paint; scroll-snap-align: start; scroll-snap-stop: always; }
      .tv-player { position: relative; width: min(100%, 620px); height: 100%; min-height: 0; max-height: none; overflow: hidden; border: 1px solid rgba(139,92,246,.34); border-radius: 20px; background: #08080b; box-shadow: 0 26px 80px rgba(0,0,0,.56), 0 0 28px rgba(109,40,217,.12); }
      .tv-profile-card { position: relative; width: 100%; height: 100%; display: block; overflow: hidden; color: inherit; background: #000; text-decoration: none; }
      .tv-profile-card:focus-visible { outline: 2px solid #67e8f9; outline-offset: -3px; }
      .tv-player video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; cursor: pointer; }
      .tv-player-shade { pointer-events: none; position: absolute; inset: 30% 0 0; background: linear-gradient(180deg, rgba(3,3,5,0), rgba(3,3,5,.24) 38%, rgba(3,3,5,.96) 100%); }
      .tv-sound { position: absolute; z-index: 5; top: 12px; right: 12px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(0,0,0,.64); font-size: 12px; font-weight: 900; cursor: pointer; }
      .tv-profile-body { position: absolute; z-index: 3; inset: auto 0 0; display: grid; gap: 5px; padding: 86px 20px 22px; background: linear-gradient(180deg, rgba(3,3,5,0), rgba(3,3,5,.66) 44%, rgba(3,3,5,.98) 100%); }
      .tv-card-info-stack { min-width: 0; display: grid; gap: 3px; }
      .tv-profile-body h2 { min-width: 0; margin: 0 0 2px; display: flex; align-items: center; gap: 6px; color: #fff; font-size: clamp(20px, 3vw, 26px); font-weight: 900; line-height: 1.04; text-shadow: 0 2px 12px rgba(0,0,0,.72); }
      .tv-card-stage-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tv-verified-mark { width: 17px; height: 17px; flex: 0 0 17px; display: inline-grid; place-items: center; border-radius: 999px; color: #041014; background: #67e8f9; box-shadow: 0 0 10px rgba(34,211,238,.36); font-size: 11px; font-weight: 950; line-height: 1; }
      .tv-card-venue-line { min-width: 0; display: flex; align-items: center; gap: 5px; color: #bdb4cc; font-size: 13px; font-weight: 760; line-height: 1.15; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
      .tv-card-venue-line svg, .tv-schedule-row svg, .tv-no-shifts-state svg { width: 15px; height: 15px; flex: 0 0 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .tv-card-venue-line svg { color: #a78bfa; }
      .tv-card-venue-name { min-width: 0; overflow: hidden; color: #e7d8ff; font-weight: 860; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 0 12px rgba(168,85,247,.2), 0 2px 10px rgba(0,0,0,.72); }
      .tv-schedule-row, .tv-no-shifts-state { min-width: 0; margin-top: 5px; display: grid; grid-template-columns: 15px minmax(0, 1fr); align-items: center; column-gap: 7px; }
      .tv-schedule-row.is-tonight svg, .tv-card-schedule-text.tonight { color: #86efac; }
      .tv-schedule-row.is-upcoming svg, .tv-card-schedule-text.upcoming { color: #93c5fd; }
      .tv-card-schedule-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(12px, 2.3vw, 14px); font-weight: 950; line-height: 1.15; text-shadow: 0 0 14px currentColor, 0 2px 12px rgba(0,0,0,.72); }
      .tv-no-shifts-state { color: rgba(184,184,197,.82); font-size: 13px; font-weight: 780; text-shadow: 0 2px 10px rgba(0,0,0,.72); }
      .tv-no-shifts-state svg { color: rgba(167,139,250,.86); }
      .tv-empty button, .tv-empty a { min-height: 44px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 7px 10px; border: 1px solid rgba(139,92,246,.28); border-radius: 8px; color: #fff; background: rgba(139,92,246,.1); font-weight: 900; text-align: center; text-decoration: none; cursor: pointer; }
      .tv-empty { max-width: 760px; min-height: 360px; margin: 20px auto; display: grid; place-items: center; align-content: center; gap: 12px; padding: 26px; border: 1px solid rgba(139,92,246,.24); border-radius: 14px; background: rgba(11,11,16,.74); text-align: center; }
      .tv-empty strong { font-size: 24px; }
      .tv-empty p { margin: 0; color: #b9accd; line-height: 1.5; }
      .tv-empty > div { display: flex; gap: 8px; }
      .tv-mobile-nav { display: none; }
      @media (max-width: 760px) {
        .tv-shell { height: 100svh; height: 100dvh; min-height: 0; padding: 0 8px calc(62px + env(safe-area-inset-bottom)); border-inline: 0; }
        .tv-global-header { position: relative; flex: 0 0 auto; margin: 0 -8px 10px; padding: 9px 10px; }
        .tv-global-topbar { gap: 8px; }
        .tv-global-logo { width: clamp(150px, 48vw, 198px); min-width: 0; }
        .tv-global-logo span { font-size: clamp(31px, 9vw, 42px); white-space: nowrap; }
        .tv-global-search, .tv-site-nav { display: none; }
        .tv-global-account { min-width: 82px; min-height: 42px; padding: 0 9px; font-size: 11px; }
        .tv-close { width: 42px; height: 42px; flex-basis: 42px; font-size: 26px; }
        .tv-header { flex: 0 0 auto; padding: 0 6px; align-items: center; }
        .tv-header h1 { font-size: 31px; }
        .tv-header > div > span { display: none; }
        .tv-filters { position: relative; flex: 0 0 auto; top: auto; margin-bottom: 4px; padding: 5px; gap: 3px; border-radius: 9px; }
        .tv-filters button { min-height: 38px; padding: 0 4px; font-size: 12px; }
        .tv-empty { flex: 1 1 auto; min-height: 0; margin: 4px 0; }
        .tv-feed { height: auto; min-height: 0; flex: 1 1 0; scrollbar-gutter: auto; }
        .tv-feed:empty { display: none; }
        .tv-slide { height: 100%; min-height: 100%; padding: 3px 0; }
        .tv-player { width: 100%; height: 100%; min-height: 0; max-height: none; border-radius: 16px; }
        .tv-player video { object-fit: contain; }
        .tv-profile-body { padding: 74px 14px 16px; }
        .tv-profile-body h2 { font-size: clamp(18px, 5.2vw, 22px); }
        .tv-card-venue-line { font-size: clamp(11px, 3.2vw, 13px); }
        .tv-card-schedule-text, .tv-no-shifts-state { font-size: clamp(11px, 3.1vw, 13px); }
        .tv-mobile-nav { position: fixed; z-index: 60; left: 0; right: 0; bottom: 0; min-height: calc(58px + env(safe-area-inset-bottom)); padding: 5px 7px env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; border-top: 1px solid rgba(255,255,255,.1); background: rgba(3,3,5,.96); backdrop-filter: blur(16px); }
        .tv-mobile-nav a { display: grid; place-items: center; border-radius: 8px; color: #9f95b1; font-size: 10px; font-weight: 900; text-decoration: none; }
        .tv-mobile-nav a.active { color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.38), rgba(34,199,255,.16)); }
      }
      @media (prefers-reduced-motion: reduce) {
        .tv-feed { scroll-behavior: auto; }
      }
    `}</style>
  );
}
