"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

const SESSION_KEY = "dancrAuthSessionV1";
const VIEWER_SESSION_KEY = "mydancrTvViewerSessionV1";
const FILTERS = [
  { value: "for-you", label: "For You" },
  { value: "following", label: "Following" },
  { value: "tonight", label: "Tonight" },
  { value: "new", label: "New" },
] as const;

type TvSource = "tv_feed" | "shared_link";

export default function TvFeedClient({
  availableCities,
  initialCity,
  initialFilter,
  initialSelectedVideoId,
  initialVideos,
  source,
}: {
  availableCities: readonly string[];
  initialCity: string;
  initialFilter: string;
  initialSelectedVideoId: string;
  initialVideos: MyDancrTvVideo[];
  source: TvSource;
}) {
  const [videos, setVideos] = useState(initialVideos);
  const cityOptions = useMemo(
    () =>
      [...new Set([...availableCities, initialCity].map((value) => value.trim()).filter(Boolean))],
    [availableCities, initialCity],
  );
  const [city, setCity] = useState(initialCity);
  const [cityDraft, setCityDraft] = useState(initialCity);
  const [filter, setFilter] = useState(
    FILTERS.some((item) => item.value === initialFilter) ? initialFilter : "for-you",
  );
  const [activeVideoId, setActiveVideoId] = useState(initialSelectedVideoId || initialVideos[0]?.id || "");
  const [muted, setMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [accountPrompt, setAccountPrompt] = useState("");
  const [accountLabel, setAccountLabel] = useState("Login / Join");
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [going, setGoing] = useState<Record<string, boolean>>({});
  const [reporting, setReporting] = useState<Record<string, boolean>>({});
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
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible || visible.intersectionRatio < 0.6) return;
        const videoId = (visible.target as HTMLElement).dataset.videoId || "";
        if (videoId) setActiveVideoId(videoId);
      },
      { threshold: [0.6, 0.8] },
    );
    document.querySelectorAll<HTMLElement>("[data-tv-slide]").forEach((element) => observer.observe(element));
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

  async function updateFollow(video: MyDancrTvVideo, enableNotifications: boolean) {
    const token = readCustomerToken();
    if (!token) {
      setAccountPrompt(
        enableNotifications
          ? "Sign in to receive reminders when this dancer posts shifts and videos."
          : "Sign in to follow this dancer and personalize MyDancr TV.",
      );
      return;
    }
    setStatus("");
    const requestedNotifications = enableNotifications
      ? notifications[video.dancer.id] !== true
      : notifications[video.dancer.id] === true;
    const requestedFollow = enableNotifications || !following[video.dancer.id];
    const response = await fetch("/api/customer/follows", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dancerId: video.dancer.id,
        following: requestedFollow,
        notificationsEnabled: requestedNotifications,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to update this dancer.");
      return;
    }
    setFollowing((current) => ({ ...current, [video.dancer.id]: data.following === true }));
    setNotifications((current) => ({ ...current, [video.dancer.id]: data.notificationsEnabled === true }));
    setStatus(
      enableNotifications
        ? data.notificationsEnabled
          ? "Reminders are on."
          : "Reminders are off."
        : data.following
          ? "Following."
          : "Unfollowed.",
    );
    if (!enableNotifications || data.notificationsEnabled) {
      trackEvent(video.id, enableNotifications ? "reminder" : "follow");
    }
  }

  async function updateGoing(video: MyDancrTvVideo) {
    if (!video.shift) return;
    const requested = !going[video.shift.id];
    setStatus("");
    const token = readCustomerToken();
    const response = await fetch("/api/customer/going", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({ shiftId: video.shift.id, going: requested }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to update Going.");
      return;
    }
    setGoing((current) => ({ ...current, [video.shift!.id]: data.going === true }));
    setStatus(data.going ? "You’re going. No sign-in was required." : "Removed from Going.");
    trackEvent(video.id, "going");
  }

  async function shareVideo(video: MyDancrTvVideo) {
    const url = `${window.location.origin}/tv/${video.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${video.dancer.stageName} on MyDancr TV`, text: video.caption, url });
      } else {
        await navigator.clipboard.writeText(url);
        setStatus("Video link copied.");
      }
      trackEvent(video.id, "share");
    } catch {
      // Closing the native share sheet is not an error the visitor needs to see.
    }
  }

  async function reportVideo(video: MyDancrTvVideo) {
    if (reporting[video.id]) return;
    setReporting((current) => ({ ...current, [video.id]: true }));
    setStatus("");
    try {
      const token = readAnyToken();
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          targetType: "tv_video",
          targetId: video.id,
          targetLabel: `${video.dancer.stageName} MyDancr TV video`,
          reason: "Video report",
          details: "Reported from MyDancr TV.",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to submit report.");
      setStatus("Video reported for admin review.");
      trackEvent(video.id, "report");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit report.");
      setReporting((current) => ({ ...current, [video.id]: false }));
    }
  }

  function changeFilter(nextFilter: string) {
    if (nextFilter === filter && videos.length) return;
    setFilter(nextFilter);
    loadFeed(nextFilter, city);
  }

  function submitCity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCity = cityOptions.find(
      (option) => option.toLocaleLowerCase() === cityDraft.trim().toLocaleLowerCase(),
    );
    if (!nextCity) return;
    setCity(nextCity);
    setCityDraft(nextCity);
    loadFeed(filter, nextCity);
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
        <form className="tv-city" onSubmit={submitCity}>
          <label htmlFor="tv-city">City</label>
          <select
            id="tv-city"
            value={cityDraft}
            onChange={(event) => setCityDraft(event.target.value)}
            disabled={isLoading}
          >
            {cityOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button type="submit" disabled={isLoading}>Go</button>
        </form>
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

      {status ? <div className="tv-status" role="status">{status}</div> : null}
      {isLoading ? <div className="tv-loading" role="status">Loading real MyDancr TV videos…</div> : null}

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

      <section className="tv-feed" aria-label="MyDancr TV videos">
        {videos.map((video) => (
          <article
            className="tv-slide"
            data-tv-slide
            data-video-id={video.id}
            data-tv-slide-key={video.id}
            key={video.id}
          >
            <div className="tv-player">
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
                onClick={(event) => {
                  const element = event.currentTarget;
                  if (element.paused) element.play().catch(() => null);
                  else element.pause();
                }}
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
              <button
                className="tv-sound"
                type="button"
                aria-label={muted ? "Turn sound on" : "Mute video"}
                onClick={() => setMuted((value) => !value)}
              >
                {muted ? "Sound off" : "Sound on"}
              </button>
              <div className="tv-video-copy">
                <Link href={`/dancers/${video.dancer.slug}`} onClick={() => trackEvent(video.id, "profile_click")}>
                  <span className="tv-avatar" style={video.dancer.primaryPhotoUrl ? { backgroundImage: `url(${video.dancer.primaryPhotoUrl})` } : undefined}>
                    {!video.dancer.primaryPhotoUrl ? initials(video.dancer.stageName) : null}
                  </span>
                  <strong>{video.dancer.stageName} <em>✓</em></strong>
                </Link>
                <p>{video.caption}</p>
                {video.shift ? (
                  <span className={video.shift.isActive ? "tv-shift live" : "tv-shift"}>
                    {video.shift.isActive ? "Working now" : video.shift.isStartingSoon ? "Starting soon" : formatShift(video.shift.startsAt)}
                  </span>
                ) : null}
              </div>
              <div className="tv-mobile-actions" aria-label="Video actions">
                <button type="button" onClick={() => updateFollow(video, false)}>
                  <span aria-hidden="true">＋</span>
                  {following[video.dancer.id] ? "Following" : "Follow"}
                </button>
                <button type="button" onClick={() => updateFollow(video, true)}>
                  <span aria-hidden="true">◉</span>
                  {notifications[video.dancer.id] ? "Reminders on" : "Remind"}
                </button>
                {video.shift ? (
                  <button type="button" onClick={() => updateGoing(video)}>
                    <span aria-hidden="true">✓</span>
                    {going[video.shift.id] ? "Going" : "Going"}
                  </button>
                ) : null}
                <Link href={`/dancers/${video.dancer.slug}`} onClick={() => trackEvent(video.id, "profile_click")}>
                  <span aria-hidden="true">♙</span>
                  Profile
                </Link>
                {video.venue ? (
                  <Link href={`/venues/${video.venue.slug}`} onClick={() => trackEvent(video.id, "venue_click")}>
                    <span aria-hidden="true">⌂</span>
                    Venue
                  </Link>
                ) : null}
                <button type="button" onClick={() => shareVideo(video)}>
                  <span aria-hidden="true">↗</span>
                  Share
                </button>
                <button type="button" disabled={reporting[video.id]} onClick={() => reportVideo(video)}>
                  <span aria-hidden="true">!</span>
                  {reporting[video.id] ? "Reported" : "Report"}
                </button>
              </div>
            </div>

            <aside className="tv-details">
              <span className="tv-kicker">{video.dancer.city}</span>
              <h2>{video.dancer.stageName}</h2>
              {video.venue ? (
                <Link className="tv-venue" href={`/venues/${video.venue.slug}`} onClick={() => trackEvent(video.id, "venue_click")}>
                  <small>{video.shift?.isActive ? "Appearing now at" : "Connected venue"}</small>
                  <strong>{video.venue.name}</strong>
                </Link>
              ) : (
                <p className="tv-unlinked">No venue is attached to this video.</p>
              )}
              <div className="tv-actions">
                <button type="button" onClick={() => updateFollow(video, false)}>
                  {following[video.dancer.id] ? "Following" : "Follow"}
                  {!readCustomerToken() ? <small>Sign in required</small> : null}
                </button>
                <button type="button" onClick={() => updateFollow(video, true)}>
                  {notifications[video.dancer.id] ? "Reminders on" : "Remind me"}
                  {!readCustomerToken() ? <small>Sign in required</small> : null}
                </button>
                {video.shift ? (
                  <button className="public-action" type="button" onClick={() => updateGoing(video)}>
                    {going[video.shift.id] ? "Going" : "I’m Going"}
                    {!readCustomerToken() ? <small>No sign-in needed</small> : null}
                  </button>
                ) : null}
                <Link href={`/dancers/${video.dancer.slug}`} onClick={() => trackEvent(video.id, "profile_click")}>View profile</Link>
                {video.venue ? (
                  <Link href={`/venues/${video.venue.slug}`} onClick={() => trackEvent(video.id, "venue_click")}>View venue</Link>
                ) : null}
                <button type="button" onClick={() => shareVideo(video)}>Share</button>
                <button className="report-action" type="button" disabled={reporting[video.id]} onClick={() => reportVideo(video)}>
                  {reporting[video.id] ? "Reported" : "Report"}
                </button>
              </div>
            </aside>
          </article>
        ))}
      </section>

      <nav className="tv-mobile-nav" aria-label="Mobile primary navigation">
        <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Now</Link>
        <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link>
        <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
        <Link href={`/trending?city=${encodeURIComponent(city)}`}>Trending</Link>
        <Link className="active" href={`/tv?city=${encodeURIComponent(city)}`}>TV</Link>
      </nav>

      {accountPrompt ? (
        <div className="tv-account-gate" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setAccountPrompt("");
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="tv-account-title">
            <button className="tv-account-close" type="button" aria-label="Close sign-in prompt" onClick={() => setAccountPrompt("")}>×</button>
            <span>Free customer account</span>
            <h2 id="tv-account-title">Sign in to continue</h2>
            <p>{accountPrompt}</p>
            <Link href="/account?role=customer&mode=signup">Create a free account</Link>
            <Link className="secondary" href="/account?role=customer">Already have an account? Sign in</Link>
          </section>
        </div>
      ) : null}
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
  const normalized = city.trim() || "Las Vegas";
  return normalized.toLowerCase() === "las vegas" ? "Vegas" : normalized;
}

function tvCitiesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
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

function formatShift(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function TvStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: radial-gradient(circle at 78% 0%, rgba(155,92,255,.16), transparent 32rem), radial-gradient(circle at 14% 10%, rgba(139,61,255,.1), transparent 24rem), #030304; color: #f8f5ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input, select { font: inherit; }
      .tv-shell { width: min(100%, 1440px); min-height: 100vh; margin: 0 auto; padding: 0 clamp(14px, 3vw, 44px) 48px; border-inline: 1px solid rgba(53,216,255,.1); background: radial-gradient(circle at 12% 0%, rgba(139,92,246,.22), transparent 25rem), radial-gradient(circle at 92% 6%, rgba(34,199,255,.12), transparent 25rem), #030305; box-shadow: 0 40px 120px rgba(0,0,0,.7); }
      .tv-global-header { position: sticky; top: 0; z-index: 40; margin: 0 calc(-1 * clamp(14px, 3vw, 44px)) 22px; padding: 16px clamp(14px, 3vw, 44px) 12px; border-bottom: 1px solid rgba(53,216,255,.12); background: rgba(3,3,4,.88); box-shadow: 0 12px 34px rgba(0,0,0,.58); backdrop-filter: blur(22px); }
      .tv-global-topbar { display: flex; align-items: center; gap: 18px; }
      .tv-global-logo { width: min(34vw, 236px); min-width: 196px; aspect-ratio: 331 / 103; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(148,68,255,.72); border-radius: 15px; color: #fff; background: #050507; box-shadow: 0 0 18px rgba(132,50,255,.24), inset 0 0 16px rgba(132,50,255,.08); text-decoration: none; }
      .tv-global-logo span { color: #fff; font-size: clamp(38px, 5.7vw, 50px); font-weight: 950; letter-spacing: -.065em; line-height: .9; text-transform: lowercase; text-shadow: 0 0 12px rgba(255,255,255,.7), 0 0 22px rgba(255,255,255,.28); transform: translateY(-1px); }
      .tv-global-logo em { color: #a855ff; font-style: normal; text-shadow: 0 0 10px rgba(168,85,255,.96), 0 0 24px rgba(139,92,246,.78), 0 0 42px rgba(124,58,237,.52); }
      .tv-global-search { width: min(520px, 34vw); min-height: 56px; display: flex; align-items: center; gap: 13px; padding: 0 18px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #7f758c; background: rgba(12,12,15,.84); box-shadow: inset 0 0 18px rgba(255,255,255,.025), 0 10px 30px rgba(0,0,0,.32); text-decoration: none; }
      .tv-global-search svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; flex: 0 0 auto; }
      .tv-global-search span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .tv-global-account { min-width: 108px; min-height: 46px; margin-left: auto; display: inline-flex; align-items: center; justify-content: center; padding: 0 17px; border: 1px solid rgba(236,72,153,.42); border-radius: 999px; color: #fff; background: rgba(9,9,15,.88); box-shadow: 0 0 22px rgba(124,58,237,.18), inset 0 1px 0 rgba(255,255,255,.04); font-size: 13px; font-weight: 900; text-decoration: none; white-space: nowrap; }
      .tv-global-logo:focus-visible, .tv-global-search:focus-visible, .tv-global-account:focus-visible { outline: 2px solid rgba(192,132,255,.72); outline-offset: 3px; }
      .tv-site-nav { max-width: 1180px; min-height: 40px; margin: 12px auto 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 7px; }
      .tv-site-nav a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; color: #d8d0e8; background: rgba(255,255,255,.035); font-size: 13px; font-weight: 850; text-decoration: none; }
      .tv-site-nav a.active { color: #fff; border-color: rgba(34,199,255,.5); background: linear-gradient(135deg, rgba(109,40,217,.35), rgba(34,199,255,.14)); box-shadow: 0 0 20px rgba(34,199,255,.1); }
      .tv-header { max-width: 1000px; margin: 0 auto 12px; display: flex; justify-content: space-between; align-items: end; gap: 18px; }
      .tv-header > div { display: grid; gap: 2px; }
      .tv-header span, .tv-kicker { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .18em; text-transform: uppercase; }
      .tv-header h1 { margin: 0; font-size: clamp(34px, 6vw, 62px); line-height: 1; }
      .tv-city { display: flex; align-items: end; gap: 6px; }
      .tv-city label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .tv-city select { width: 158px; min-height: 40px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; background: #111117; color: #fff; padding: 0 34px 0 14px; cursor: pointer; }
      .tv-city select:disabled, .tv-city button:disabled { opacity: .62; cursor: wait; }
      .tv-city button { min-height: 40px; padding: 0 14px; border: 1px solid rgba(34,199,255,.4); border-radius: 999px; background: rgba(34,199,255,.1); color: #fff; font-weight: 900; cursor: pointer; }
      .tv-filters { position: sticky; top: 0; z-index: 20; max-width: 1000px; margin: 0 auto 12px; padding: 8px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(5,5,8,.9); backdrop-filter: blur(16px); }
      .tv-filters button { min-height: 42px; border: 1px solid transparent; border-radius: 8px; color: #a99ebc; background: transparent; font-weight: 900; cursor: pointer; }
      .tv-filters button.active { color: #fff; border-color: rgba(139,92,246,.44); background: linear-gradient(135deg, rgba(109,40,217,.34), rgba(34,199,255,.12)); }
      .tv-status, .tv-loading { max-width: 1000px; margin: 0 auto 10px; padding: 10px 14px; border: 1px solid rgba(34,199,255,.2); border-radius: 8px; background: rgba(34,199,255,.07); color: #a9efff; font-size: 13px; font-weight: 800; }
      .tv-feed { max-width: 1000px; height: calc(100svh - 210px); min-height: 520px; margin: 0 auto; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: thin; scrollbar-color: rgba(139,92,246,.48) transparent; }
      .tv-slide { min-height: 100%; padding: 8px 0; display: grid; grid-template-columns: minmax(320px, 520px) minmax(260px, 1fr); justify-content: center; gap: 14px; scroll-snap-align: start; scroll-snap-stop: always; }
      .tv-player { position: relative; height: calc(100svh - 226px); min-height: 500px; max-height: 820px; overflow: hidden; border: 1px solid rgba(139,92,246,.34); border-radius: 14px; background: #08080b; box-shadow: 0 26px 80px rgba(0,0,0,.56), 0 0 28px rgba(109,40,217,.12); }
      .tv-player video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; cursor: pointer; }
      .tv-player-shade { pointer-events: none; position: absolute; inset: 42% 0 0; background: linear-gradient(180deg, transparent, rgba(0,0,0,.86)); }
      .tv-sound { position: absolute; top: 12px; right: 12px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(0,0,0,.58); font-size: 12px; font-weight: 900; cursor: pointer; }
      .tv-video-copy { position: absolute; left: 16px; right: 16px; bottom: 16px; display: grid; gap: 9px; }
      .tv-mobile-actions { display: none; }
      .tv-video-copy > a { width: fit-content; display: flex; align-items: center; gap: 9px; color: #fff; text-decoration: none; }
      .tv-video-copy strong { font-size: 18px; }
      .tv-video-copy em { color: #7eeaff; font-style: normal; }
      .tv-avatar { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid rgba(126,234,255,.65); border-radius: 50%; background: linear-gradient(135deg, #6d28d9, #0b94c9); background-position: center; background-size: cover; font-size: 11px; font-weight: 950; }
      .tv-video-copy p { margin: 0; max-width: 44ch; color: #f6f1ff; font-size: 14px; font-weight: 750; line-height: 1.4; text-shadow: 0 2px 8px #000; }
      .tv-shift { width: fit-content; padding: 5px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #fff; background: rgba(0,0,0,.55); font-size: 11px; font-weight: 950; letter-spacing: .06em; text-transform: uppercase; }
      .tv-shift.live { color: #7effba; border-color: rgba(58,255,164,.4); background: rgba(14,106,66,.38); }
      .tv-details { align-self: center; display: grid; gap: 13px; padding: 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: rgba(11,11,16,.82); }
      .tv-details h2 { margin: 0; font-size: clamp(28px, 4vw, 44px); line-height: .95; overflow-wrap: anywhere; }
      .tv-venue { display: grid; gap: 4px; padding: 13px; border: 1px solid rgba(34,199,255,.2); border-radius: 8px; color: #fff; background: rgba(34,199,255,.07); text-decoration: none; }
      .tv-venue small, .tv-unlinked { margin: 0; color: #a99ebc; font-size: 12px; }
      .tv-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
      .tv-actions button, .tv-actions a, .tv-empty button, .tv-empty a { min-height: 44px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 7px 10px; border: 1px solid rgba(139,92,246,.28); border-radius: 8px; color: #fff; background: rgba(139,92,246,.1); font-weight: 900; text-align: center; text-decoration: none; cursor: pointer; }
      .tv-actions button small { color: #a99ebc; font-size: 9px; }
      .tv-actions button.public-action { border-color: rgba(34,199,255,.34); background: rgba(34,199,255,.09); }
      .tv-actions button.public-action small { color: #7eeaff; }
      .tv-actions button.report-action { color: #ffb7c3; border-color: rgba(255,91,116,.22); background: rgba(255,91,116,.06); }
      .tv-actions button:disabled { opacity: .65; cursor: default; }
      .tv-empty { max-width: 760px; min-height: 360px; margin: 20px auto; display: grid; place-items: center; align-content: center; gap: 12px; padding: 26px; border: 1px solid rgba(139,92,246,.24); border-radius: 14px; background: rgba(11,11,16,.74); text-align: center; }
      .tv-empty strong { font-size: 24px; }
      .tv-empty p { margin: 0; color: #b9accd; line-height: 1.5; }
      .tv-empty > div { display: flex; gap: 8px; }
      .tv-mobile-nav { display: none; }
      .tv-account-gate { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.78); backdrop-filter: blur(12px); }
      .tv-account-gate > section { position: relative; width: min(420px, 100%); display: grid; gap: 12px; padding: 24px; border: 1px solid rgba(34,199,255,.36); border-radius: 14px; background: #09090e; }
      .tv-account-gate span { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .tv-account-gate h2, .tv-account-gate p { margin: 0; }
      .tv-account-gate p { color: #b9accd; line-height: 1.5; }
      .tv-account-gate a { min-height: 46px; display: grid; place-items: center; border: 1px solid rgba(34,199,255,.42); border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; text-decoration: none; text-align: center; }
      .tv-account-gate a.secondary { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.04); }
      .tv-account-close { position: absolute; top: 10px; right: 10px; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; color: #fff; background: rgba(255,255,255,.04); font-size: 24px; cursor: pointer; }
      @media (max-width: 760px) {
        .tv-shell { padding: 0 8px 72px; border-inline: 0; }
        .tv-global-header { margin: 0 -8px 10px; padding: 9px 10px; }
        .tv-global-topbar { gap: 8px; }
        .tv-global-logo { width: clamp(150px, 48vw, 198px); min-width: 0; }
        .tv-global-logo span { font-size: clamp(31px, 9vw, 42px); white-space: nowrap; }
        .tv-global-search, .tv-site-nav { display: none; }
        .tv-global-account { min-width: 92px; min-height: 42px; padding: 0 11px; font-size: 12px; }
        .tv-header { padding: 0 6px; align-items: center; }
        .tv-header h1 { font-size: 31px; }
        .tv-header > div > span { display: none; }
        .tv-city select { width: 132px; }
        .tv-filters { top: 0; margin-bottom: 4px; padding: 5px; gap: 3px; border-radius: 9px; }
        .tv-filters button { min-height: 38px; padding: 0 4px; font-size: 12px; }
        .tv-feed { height: calc(100svh - 142px); min-height: 430px; }
        .tv-slide { min-height: 100%; padding: 3px 0; grid-template-columns: 1fr; }
        .tv-player { height: calc(100svh - 150px); min-height: 430px; max-height: none; border-radius: 10px; }
        .tv-details { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        .tv-player video { object-fit: contain; }
        .tv-video-copy { right: 76px; bottom: 20px; }
        .tv-video-copy p { font-size: 13px; }
        .tv-mobile-actions { position: absolute; z-index: 4; right: 8px; bottom: 16px; display: grid; gap: 5px; }
        .tv-mobile-actions button, .tv-mobile-actions a { width: 58px; min-height: 46px; display: grid; place-items: center; align-content: center; gap: 1px; padding: 2px; border: 0; border-radius: 8px; color: #fff; background: rgba(0,0,0,.58); font-size: 9px; font-weight: 900; text-decoration: none; text-shadow: 0 1px 5px #000; cursor: pointer; }
        .tv-mobile-actions span { font-size: 18px; line-height: 1; }
        .tv-mobile-nav { position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; min-height: calc(58px + env(safe-area-inset-bottom)); padding: 5px 7px env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 3px; border-top: 1px solid rgba(255,255,255,.1); background: rgba(3,3,5,.94); backdrop-filter: blur(16px); }
        .tv-mobile-nav a { display: grid; place-items: center; border-radius: 8px; color: #9f95b1; font-size: 10px; font-weight: 900; text-decoration: none; }
        .tv-mobile-nav a.active { color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.38), rgba(34,199,255,.16)); }
        .tv-status, .tv-loading { margin: 0 0 5px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .tv-feed { scroll-behavior: auto; }
      }
    `}</style>
  );
}
