"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

const SESSION_KEY = "dancrAuthSessionV1";
const VIEWER_SESSION_KEY = "mydancrTvViewerSessionV1";
const FILTERS = [
  { value: "for-you", label: "For You" },
  { value: "following", label: "Following" },
  { value: "tonight", label: "Tonight" },
] as const;

type TvSource = "tv_feed" | "shared_link";
type SessionRole = "customer" | "dancer" | "venue" | "admin";
type TvAuthSession = {
  accessToken?: string;
  account?: {
    role?: SessionRole;
  } | null;
};
type TvNotification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export default function TvFeedClient({
  initialCity,
  initialDancerId = "",
  initialFilter,
  initialSelectedVideoId,
  initialVideos,
  source,
}: {
  initialCity: string;
  initialDancerId?: string;
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
  const [autoplayBlockedVideoId, setAutoplayBlockedVideoId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [session, setSession] = useState<TvAuthSession | null>(null);
  const [notifications, setNotifications] = useState<TvNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const feedElement = useRef<HTMLElement | null>(null);
  const headerActionsElement = useRef<HTMLDivElement | null>(null);
  const videoElements = useRef<Record<string, HTMLVideoElement | null>>({});
  const activeVideoIdRef = useRef(activeVideoId);
  const mutedRef = useRef(muted);
  const manuallyPausedVideoId = useRef("");
  const engagedTimers = useRef<Record<string, number>>({});
  const completedVideos = useRef(new Set<string>());
  const loadedAuthenticatedFeed = useRef(false);
  const viewerSessionId = useMemo(readViewerSessionId, []);
  activeVideoIdRef.current = activeVideoId;
  mutedRef.current = muted;

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

  const attemptVideoPlayback = useCallback(async (
    videoId: string,
    element: HTMLVideoElement,
  ) => {
    if (
      videoId !== activeVideoIdRef.current ||
      manuallyPausedVideoId.current === videoId ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    element.autoplay = true;
    element.muted = mutedRef.current;
    try {
      await element.play();
      setAutoplayBlockedVideoId((current) => current === videoId ? "" : current);
      return;
    } catch (error) {
      if (
        videoId !== activeVideoIdRef.current ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
    }

    if (!element.muted) {
      mutedRef.current = true;
      element.muted = true;
      setMuted(true);
      try {
        await element.play();
        setAutoplayBlockedVideoId((current) => current === videoId ? "" : current);
        return;
      } catch (error) {
        if (
          videoId !== activeVideoIdRef.current ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
      }
    }

    setAutoplayBlockedVideoId(videoId);
  }, []);

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
      if (initialDancerId) params.set("dancer", initialDancerId);
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
      if (initialDancerId) url.searchParams.set("dancer", initialDancerId);
      else url.searchParams.delete("dancer");
      url.searchParams.delete("video");
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load MyDancr TV.");
    } finally {
      setIsLoading(false);
    }
  }, [initialDancerId]);

  useEffect(() => {
    const nextSession = readSession();
    setSession(nextSession);
    const role = nextSession?.account?.role;
    if (
      !nextSession?.accessToken ||
      (role !== "customer" && role !== "dancer")
    ) {
      return;
    }

    const controller = new AbortController();
    setNotificationsLoading(true);
    fetch("/api/notifications", {
      headers: { authorization: `Bearer ${nextSession.accessToken}` },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Unable to load notifications.");
        }
        setNotifications(normalizeNotifications(data.notifications));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotificationStatus(
          error instanceof Error ? error.message : "Unable to load notifications.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotificationsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!headerActionsElement.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

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
        if (videoId) {
          if (videoId !== activeVideoIdRef.current) {
            manuallyPausedVideoId.current = "";
          }
          setActiveVideoId(videoId);
        }
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
        void attemptVideoPlayback(videoId, element);
        trackEvent(videoId, "impression");
        window.clearTimeout(engagedTimers.current[videoId]);
        engagedTimers.current[videoId] = window.setTimeout(() => {
          if (!element.paused) trackEvent(videoId, "engaged_view");
        }, 3000);
      } else {
        element.autoplay = false;
        element.pause();
        window.clearTimeout(engagedTimers.current[videoId]);
      }
    });
  }, [activeVideoId, attemptVideoPlayback, muted, trackEvent]);

  useEffect(() => {
    const resumeActiveVideo = () => {
      if (document.visibilityState === "hidden") return;
      const videoId = activeVideoIdRef.current;
      const element = videoElements.current[videoId];
      if (videoId && element) void attemptVideoPlayback(videoId, element);
    };
    document.addEventListener("visibilitychange", resumeActiveVideo);
    window.addEventListener("pageshow", resumeActiveVideo);
    return () => {
      document.removeEventListener("visibilitychange", resumeActiveVideo);
      window.removeEventListener("pageshow", resumeActiveVideo);
    };
  }, [attemptVideoPlayback]);

  useEffect(() => () => {
    Object.values(engagedTimers.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  function changeFilter(nextFilter: string) {
    if (nextFilter === filter && videos.length) return;
    setFilter(nextFilter);
    loadFeed(nextFilter, city);
  }

  function toggleVideoPlayback(videoId: string, element: HTMLVideoElement) {
    if (element.paused) {
      manuallyPausedVideoId.current = "";
      void attemptVideoPlayback(videoId, element);
      return;
    }
    manuallyPausedVideoId.current = videoId;
    setAutoplayBlockedVideoId("");
    element.pause();
  }

  async function markNotificationRead(notificationId: string) {
    if (!session?.accessToken) return;
    setNotificationStatus("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ notificationId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to update notification.");
      }
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: data.notification?.readAt || new Date().toISOString() }
            : notification,
        ),
      );
    } catch (error) {
      setNotificationStatus(
        error instanceof Error ? error.message : "Unable to update notification.",
      );
    }
  }

  async function clearNotifications() {
    if (!session?.accessToken) return;
    setNotificationStatus("");
    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to clear notifications.");
      }
      setNotifications([]);
      setNotificationStatus("Notifications cleared.");
    } catch (error) {
      setNotificationStatus(
        error instanceof Error ? error.message : "Unable to clear notifications.",
      );
    }
  }

  const role = session?.account?.role;
  const showNotifications =
    Boolean(session?.accessToken) && (role === "customer" || role === "dancer");
  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.readAt,
  ).length;
  const homepageHref = `/?city=${encodeURIComponent(city)}&view=tonight`;

  return (
    <main className="tv-shell">
      <TvStyles />
      <header className="tv-global-header">
        <div className="tv-global-topbar">
          <Link className="tv-global-logo" href={homepageHref} aria-label="Go to Mydancr home">
            <span aria-hidden="true">mydanc<em>r</em></span>
          </Link>
          <div className="tv-header-actions" ref={headerActionsElement}>
            {showNotifications ? (
              <button
                className={notificationsOpen ? "tv-notification-button active" : "tv-notification-button"}
                type="button"
                aria-label="Open notifications"
                aria-expanded={notificationsOpen}
                aria-controls="tv-notification-panel"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                {unreadNotificationCount ? (
                  <span className="tv-notification-count">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                ) : null}
                <BellIcon />
              </button>
            ) : null}
            {role ? (
              <Link
                className="tv-global-account tv-account-icon"
                href={dashboardHref(role)}
                aria-label={`Open ${role} dashboard`}
                title={`${capitalize(role)} dashboard`}
              >
                <AccountIcon />
              </Link>
            ) : (
              <Link className="tv-global-account" href="/account">Login / Join</Link>
            )}
            {showNotifications && notificationsOpen ? (
              <section
                className="tv-notification-panel"
                id="tv-notification-panel"
                aria-label="Notifications"
              >
                <div className="tv-notification-head">
                  <div>
                    <strong>Notifications</strong>
                    <span>{unreadNotificationCount} unread</span>
                  </div>
                  <Link href={dashboardHref(role)}>Open dashboard</Link>
                </div>
                <div className="tv-notification-list">
                  {notificationsLoading ? <p>Loading notifications…</p> : null}
                  {!notificationsLoading && !notifications.length ? <p>No notifications yet.</p> : null}
                  {notifications.slice(0, 8).map((notification) => (
                    <button
                      className={notification.readAt ? "read" : ""}
                      type="button"
                      key={notification.id}
                      onClick={() => markNotificationRead(notification.id)}
                    >
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                    </button>
                  ))}
                </div>
                {notifications.length ? (
                  <button className="tv-notification-clear" type="button" onClick={clearNotifications}>
                    Clear notifications
                  </button>
                ) : null}
                {notificationStatus ? <p className="tv-notification-status" role="status">{notificationStatus}</p> : null}
              </section>
            ) : null}
          </div>
        </div>
      </header>

      <header className="tv-header">
        <div>
          <span>Watch. Discover. Go.</span>
          <h1>MyDancr TV {myDancrTvCityLabel(city)}</h1>
        </div>
          <Link
            className="tv-close"
            href={homepageHref}
            aria-label="Close MyDancr TV and return to homepage"
          >
            ×
          </Link>
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
            <Link href={homeDiscoveryHref("dancers", city)}>Browse dancers</Link>
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
              <div className="tv-profile-card">
                <video
                  ref={(element) => {
                    videoElements.current[video.id] = element;
                  }}
                  aria-label={`${video.dancer.stageName} MyDancr TV video. Play or pause.`}
                  role="button"
                  tabIndex={0}
                  autoPlay={video.id === activeVideoId}
                  loop
                  muted={muted}
                  playsInline
                  preload={video.id === activeVideoId ? "auto" : "metadata"}
                  src={video.videoUrl}
                  onCanPlay={(event) => {
                    if (video.id === activeVideoIdRef.current && event.currentTarget.paused) {
                      void attemptVideoPlayback(video.id, event.currentTarget);
                    }
                  }}
                  onClick={(event) => toggleVideoPlayback(video.id, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleVideoPlayback(video.id, event.currentTarget);
                  }}
                  onPlay={() => {
                    setAutoplayBlockedVideoId((current) => current === video.id ? "" : current);
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
                {autoplayBlockedVideoId === video.id ? (
                  <button
                    className="tv-playback-retry"
                    type="button"
                    onClick={() => {
                      manuallyPausedVideoId.current = "";
                      const element = videoElements.current[video.id];
                      if (element) void attemptVideoPlayback(video.id, element);
                    }}
                  >
                    Tap to play
                  </button>
                ) : null}
                <div className="tv-player-shade" />
                <div className="tv-profile-body">
                  <span
                    className={`tv-profile-photo${video.dancer.primaryPhotoUrl ? " has-photo" : ""}`}
                    style={video.dancer.primaryPhotoUrl
                      ? { backgroundImage: `url(${JSON.stringify(video.dancer.primaryPhotoUrl)})` }
                      : undefined}
                    aria-hidden="true"
                  >
                    {video.dancer.primaryPhotoUrl ? null : dancerInitials(video.dancer.stageName)}
                  </span>
                  <div className="tv-profile-details">
                    <div className="tv-card-info-stack">
                      <h2>
                        <Link
                          className="tv-card-stage-link"
                          href={dancerLiveProfileHref(video)}
                          aria-label={`Open ${video.dancer.stageName}'s live profile`}
                          onClick={() => trackEvent(video.id, "profile_click")}
                        >
                          <span className="tv-card-stage-identity">
                            <span className="tv-card-stage-row">
                              <span className="tv-card-stage-name">{video.dancer.stageName}</span>
                              <span className="tv-verified-mark" aria-label="Verified">✓</span>
                            </span>
                            <span className="tv-profile-destination">
                              View Profile <span aria-hidden="true">→</span>
                            </span>
                          </span>
                        </Link>
                      </h2>
                      {video.venue ? (
                        <Link
                          className="tv-card-venue-line"
                          href={venueLiveProfileHref(video)}
                          aria-label={`Open ${video.venue.name} venue profile`}
                          onClick={() => trackEvent(video.id, "venue_click")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                            <circle cx="12" cy="10" r="2.5" />
                          </svg>
                          <span className="tv-card-venue-name">{video.venue.name}</span>
                        </Link>
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
                    {video.shift?.isActive && video.venue && video.deal ? (
                      <ClubDealCard
                        deal={video.deal}
                        venueId={video.venue.id}
                        venueName={video.venue.name}
                        sourceType="dancer_profile"
                        dancerId={video.dancer.id}
                        attributionToken={video.dealAttributionToken}
                        presentation="launcher"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
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

    </main>
  );
}

function readSession(): TvAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function normalizeNotifications(value: unknown): TvNotification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const notification = item as Record<string, unknown>;
    const id = typeof notification.id === "string" ? notification.id : "";
    if (!id) return [];
    return [{
      id,
      title: typeof notification.title === "string" && notification.title.trim()
        ? notification.title.trim()
        : "Notification",
      body: typeof notification.body === "string" ? notification.body.trim() : "",
      readAt: typeof notification.readAt === "string" ? notification.readAt : null,
      createdAt: typeof notification.createdAt === "string" ? notification.createdAt : "",
    }];
  });
}

function dashboardHref(role: SessionRole | undefined) {
  if (role === "dancer") return "/dashboard/dancer";
  if (role === "venue") return "/dashboard/venue";
  if (role === "admin") return "/admin";
  return "/dashboard/customer";
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function myDancrTvCityLabel(city: string) {
  return city.trim() || "Las Vegas";
}

function tvCitiesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function dancerLiveProfileHref(video: MyDancrTvVideo) {
  const city = video.dancer.city.trim() || "Las Vegas";
  const slug = video.dancer.slug.trim();
  return slug
    ? `/?city=${encodeURIComponent(city)}&profile=${encodeURIComponent(slug)}`
    : homeDiscoveryHref("dancers", city);
}

function venueLiveProfileHref(video: MyDancrTvVideo) {
  if (!video.venue) return "/";
  const city = video.dancer.city.trim() || "Las Vegas";
  const venue = video.venue.slug.trim() || slugifyLiveProfileName(video.venue.name);
  return `/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(venue)}`;
}

function slugifyLiveProfileName(value: string) {
  return value.toLowerCase().replaceAll(" ", "-").replace(/[^a-z0-9-]/g, "");
}

function dancerInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "D";
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
      .tv-global-topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
      .tv-global-logo { width: min(34vw, 236px); min-width: 196px; aspect-ratio: 331 / 103; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(148,68,255,.72); border-radius: 15px; color: #fff; background: #050507; box-shadow: 0 0 18px rgba(132,50,255,.24), inset 0 0 16px rgba(132,50,255,.08); text-decoration: none; }
      .tv-global-logo span { color: #fff; font-size: clamp(38px, 5.7vw, 50px); font-weight: 950; letter-spacing: -.065em; line-height: .9; text-transform: lowercase; text-shadow: 0 0 12px rgba(255,255,255,.7), 0 0 22px rgba(255,255,255,.28); transform: translateY(-1px); }
      .tv-global-logo em { color: #a855ff; font-style: normal; text-shadow: 0 0 10px rgba(168,85,255,.96), 0 0 24px rgba(139,92,246,.78), 0 0 42px rgba(124,58,237,.52); }
      .tv-header-actions { position: relative; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
      .tv-global-account { width: 109px; min-width: 92px; min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 22px; border: 1px solid rgba(236,72,153,.42); border-radius: 999px; color: #fff; background: rgba(9,9,15,.88); box-shadow: 0 0 22px rgba(124,58,237,.18), inset 0 1px 0 rgba(255,255,255,.04); font-size: 12px; font-weight: 850; text-decoration: none; white-space: nowrap; }
      .tv-global-account.tv-account-icon, .tv-notification-button { position: relative; padding: 0; border: 1px solid rgba(139,92,246,.52); border-radius: 999px; color: #fff; background: rgba(10,10,14,.88); box-shadow: 0 0 20px rgba(124,58,237,.18), inset 0 0 16px rgba(255,255,255,.035); cursor: pointer; }
      .tv-global-account.tv-account-icon { width: 44px; min-width: 44px; min-height: 44px; }
      .tv-notification-button { width: 42px; min-width: 42px; min-height: 42px; }
      .tv-global-account.tv-account-icon { display: grid; place-items: center; }
      .tv-global-account.tv-account-icon svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .tv-notification-button svg { width: 18px; height: 18px; display: block; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .tv-notification-button { display: grid; place-items: center; color: #22c7ff; }
      .tv-notification-button:hover, .tv-notification-button:focus-visible, .tv-notification-button.active, .tv-global-account:hover, .tv-global-account:focus-visible { border-color: rgba(34,199,255,.68); box-shadow: 0 0 22px rgba(34,199,255,.2), 0 0 18px rgba(139,92,246,.18); }
      .tv-notification-count { position: absolute; z-index: 2; top: -7px; left: -8px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; border-radius: 999px; color: #050507; background: #22c7ff; box-shadow: 0 0 14px rgba(34,199,255,.42); font-size: 10px; font-weight: 950; }
      .tv-notification-panel { position: absolute; z-index: 80; top: calc(100% + 12px); right: 0; width: min(340px, calc(100vw - 28px)); max-height: min(520px, 70dvh); display: grid; gap: 10px; padding: 14px; overflow: auto; border: 1px solid rgba(139,92,246,.42); border-radius: 14px; color: #f7f4ff; background: rgba(5,5,9,.98); box-shadow: 0 22px 60px rgba(0,0,0,.68), 0 0 28px rgba(109,40,217,.2); }
      .tv-notification-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .tv-notification-head > div { display: grid; gap: 2px; }
      .tv-notification-head strong { font-size: 16px; }
      .tv-notification-head span { color: #a99fba; font-size: 11px; font-weight: 800; }
      .tv-notification-head a { color: #7eeaff; font-size: 11px; font-weight: 900; text-decoration: none; }
      .tv-notification-list { display: grid; gap: 7px; }
      .tv-notification-list p { margin: 0; padding: 12px; color: #aaa0b8; text-align: center; }
      .tv-notification-list button { display: grid; gap: 3px; padding: 10px 11px; border: 1px solid rgba(34,199,255,.2); border-radius: 10px; color: #f6f3fb; background: rgba(34,199,255,.07); text-align: left; cursor: pointer; }
      .tv-notification-list button.read { border-color: rgba(255,255,255,.08); background: rgba(255,255,255,.025); }
      .tv-notification-list button strong { font-size: 12px; }
      .tv-notification-list button span { color: #bdb4ca; font-size: 11px; line-height: 1.35; }
      .tv-notification-clear { min-height: 38px; border: 1px solid rgba(139,92,246,.32); border-radius: 999px; color: #fff; background: rgba(109,40,217,.16); font-weight: 900; cursor: pointer; }
      .tv-notification-status { margin: 0; color: #9fefff; font-size: 11px; font-weight: 800; }
      .tv-close { width: 46px; height: 46px; flex: 0 0 46px; display: grid; place-items: center; border: 1px solid rgba(53,216,255,.46); border-radius: 50%; color: #fff; background: rgba(5,5,9,.9); box-shadow: 0 0 22px rgba(53,216,255,.14); font-size: 28px; line-height: 1; text-decoration: none; }
      .tv-global-logo:focus-visible, .tv-global-account:focus-visible, .tv-close:focus-visible { outline: 2px solid rgba(192,132,255,.72); outline-offset: 3px; }
      .tv-header { width: 100%; max-width: 1000px; flex: 0 0 auto; margin: 0 auto 12px; padding: 13px 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1px solid rgba(139,92,246,.28); border-radius: 14px; background: rgba(7,7,11,.84); box-shadow: inset 0 0 20px rgba(109,40,217,.06); }
      .tv-header > div { display: grid; gap: 2px; }
      .tv-header span, .tv-kicker { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .18em; text-transform: uppercase; }
      .tv-header h1 { margin: 0; font-size: clamp(30px, 4.2vw, 48px); line-height: 1; }
      .tv-filters { position: relative; flex: 0 0 auto; z-index: 20; width: 100%; max-width: 1000px; margin: 0 auto 12px; padding: 8px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(5,5,8,.9); backdrop-filter: blur(16px); }
      .tv-filters button { min-height: 42px; border: 1px solid transparent; border-radius: 8px; color: #a99ebc; background: transparent; font-weight: 900; cursor: pointer; }
      .tv-filters button.active { color: #fff; border-color: rgba(139,92,246,.44); background: linear-gradient(135deg, rgba(109,40,217,.34), rgba(34,199,255,.12)); }
      .tv-feedback { position: relative; z-index: 30; width: 100%; max-width: 1000px; height: 0; flex: 0 0 0; margin: 0 auto; pointer-events: none; }
      .tv-status, .tv-loading { position: absolute; top: 6px; left: 0; right: 0; margin: 0; padding: 10px 14px; border: 1px solid rgba(34,199,255,.2); border-radius: 8px; background: rgba(5,17,22,.94); box-shadow: 0 10px 28px rgba(0,0,0,.48); color: #a9efff; font-size: 13px; font-weight: 800; }
      .tv-feed { width: 100%; max-width: 1000px; height: auto; min-height: 0; flex: 1 1 0; margin: 0 auto; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; overflow-anchor: none; touch-action: pan-y; scroll-snap-type: y mandatory; scroll-padding-block: 0; scroll-behavior: smooth; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(139,92,246,.48) transparent; }
      .tv-slide { height: 100%; min-height: 100%; max-height: 100%; padding: 8px 0; display: grid; place-items: center; overflow: hidden; contain: layout paint; scroll-snap-align: start; scroll-snap-stop: always; }
      .tv-player { position: relative; width: min(100%, 620px); height: 100%; min-height: 0; max-height: none; overflow: hidden; border: 1px solid rgba(139,92,246,.34); border-radius: 20px; background: #08080b; box-shadow: 0 26px 80px rgba(0,0,0,.56), 0 0 28px rgba(109,40,217,.12); }
      .tv-profile-card { position: relative; width: 100%; height: 100%; display: block; overflow: hidden; color: inherit; background: #000; text-decoration: none; }
      .tv-player video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; cursor: pointer; }
      .tv-player video:focus-visible { outline: 2px solid #67e8f9; outline-offset: -3px; }
      .tv-playback-retry { position: absolute; z-index: 6; top: 50%; left: 50%; min-height: 46px; padding: 0 18px; border: 1px solid rgba(126,234,255,.58); border-radius: 999px; color: #fff; background: rgba(3,3,7,.82); box-shadow: 0 0 28px rgba(34,199,255,.2); font-weight: 950; transform: translate(-50%, -50%); cursor: pointer; }
      .tv-player-shade { pointer-events: none; position: absolute; inset: 30% 0 0; background: linear-gradient(180deg, rgba(3,3,5,0), rgba(3,3,5,.24) 38%, rgba(3,3,5,.96) 100%); }
      .tv-sound { position: absolute; z-index: 5; top: 12px; right: 12px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(0,0,0,.64); font-size: 12px; font-weight: 900; cursor: pointer; }
      .tv-profile-body { position: absolute; z-index: 3; inset: auto 0 0; display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: end; gap: 14px; padding: 86px 20px 22px; background: linear-gradient(180deg, rgba(3,3,5,0), rgba(3,3,5,.66) 44%, rgba(3,3,5,.98) 100%); }
      .tv-profile-photo { width: 58px; height: 58px; display: grid; place-items: center; overflow: hidden; border: 2px solid rgba(126,234,255,.92); border-radius: 50%; color: #fff; background-color: #24113c; background-position: center; background-repeat: no-repeat; background-size: cover; box-shadow: 0 0 0 3px rgba(139,92,246,.34), 0 10px 28px rgba(0,0,0,.56), 0 0 24px rgba(34,199,255,.28); font-size: 18px; font-weight: 950; letter-spacing: .03em; text-shadow: 0 2px 8px rgba(0,0,0,.7); }
      .tv-profile-photo.has-photo { background-color: #08080b; filter: none; opacity: 1; mix-blend-mode: normal; }
      .tv-profile-details { min-width: 0; display: grid; gap: 5px; }
      .tv-card-info-stack { min-width: 0; display: grid; gap: 3px; }
      .tv-profile-body h2 { min-width: 0; margin: 0 0 2px; display: flex; align-items: center; gap: 6px; color: #fff; font-size: clamp(20px, 3vw, 26px); font-weight: 900; line-height: 1.04; text-shadow: 0 2px 12px rgba(0,0,0,.72); }
      .tv-card-stage-link { width: fit-content; min-width: 0; max-width: 100%; display: block; color: inherit; text-decoration: none; }
      .tv-card-stage-identity { min-width: 0; display: grid; gap: 4px; }
      .tv-card-stage-row { min-width: 0; display: flex; align-items: center; gap: 6px; }
      .tv-card-stage-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tv-profile-destination { width: fit-content; display: inline-flex; align-items: center; gap: 5px; color: #9fefff; font-size: 10px; font-weight: 950; letter-spacing: .07em; line-height: 1.1; text-transform: uppercase; text-shadow: 0 0 12px rgba(34,199,255,.3), 0 2px 8px rgba(0,0,0,.8); }
      .tv-verified-mark { width: 17px; height: 17px; flex: 0 0 17px; display: inline-grid; place-items: center; border-radius: 999px; color: #041014; background: #67e8f9; box-shadow: 0 0 10px rgba(34,211,238,.36); font-size: 11px; font-weight: 950; line-height: 1; }
      .tv-card-venue-line { width: fit-content; min-width: 0; max-width: 100%; display: flex; align-items: center; gap: 5px; color: #bdb4cc; font-size: 13px; font-weight: 760; line-height: 1.15; text-decoration: none; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
      .tv-card-stage-link:focus-visible, .tv-card-venue-line:focus-visible { outline: 2px solid #67e8f9; outline-offset: 3px; border-radius: 4px; }
      .tv-card-venue-line svg, .tv-schedule-row svg, .tv-no-shifts-state svg { width: 15px; height: 15px; flex: 0 0 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .tv-card-venue-line svg { color: #a78bfa; }
      .tv-card-venue-name { min-width: 0; overflow: hidden; color: #e7d8ff; font-weight: 860; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 0 12px rgba(168,85,247,.2), 0 2px 10px rgba(0,0,0,.72); }
      .tv-schedule-row, .tv-no-shifts-state { min-width: 0; margin-top: 5px; display: grid; grid-template-columns: 15px minmax(0, 1fr); align-items: center; column-gap: 7px; }
      .tv-schedule-row.is-tonight svg, .tv-card-schedule-text.tonight { color: #86efac; }
      .tv-schedule-row.is-upcoming svg, .tv-card-schedule-text.upcoming { color: #93c5fd; }
      .tv-card-schedule-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(12px, 2.3vw, 14px); font-weight: 950; line-height: 1.15; text-shadow: 0 0 14px currentColor, 0 2px 12px rgba(0,0,0,.72); }
      .tv-no-shifts-state { color: rgba(184,184,197,.82); font-size: 13px; font-weight: 780; text-shadow: 0 2px 10px rgba(0,0,0,.72); }
      .tv-no-shifts-state svg { color: rgba(167,139,250,.86); }
      .tv-profile-details > .club-deal-launcher { margin-top: 5px; }
      .tv-empty button, .tv-empty a { min-height: 44px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 7px 10px; border: 1px solid rgba(139,92,246,.28); border-radius: 8px; color: #fff; background: rgba(139,92,246,.1); font-weight: 900; text-align: center; text-decoration: none; cursor: pointer; }
      .tv-empty { max-width: 760px; min-height: 360px; margin: 20px auto; display: grid; place-items: center; align-content: center; gap: 12px; padding: 26px; border: 1px solid rgba(139,92,246,.24); border-radius: 14px; background: rgba(11,11,16,.74); text-align: center; }
      .tv-empty strong { font-size: 24px; }
      .tv-empty p { margin: 0; color: #b9accd; line-height: 1.5; }
      .tv-empty > div { display: flex; gap: 8px; }
      @media (max-width: 760px) {
        .tv-shell { height: 100svh; height: 100dvh; min-height: 0; padding: 0 8px calc(62px + env(safe-area-inset-bottom)); border-inline: 0; }
        .tv-global-header { position: relative; flex: 0 0 auto; margin: 0 -8px 10px; padding: calc(9px + env(safe-area-inset-top, 0px)) 10px 9px; }
        .tv-global-topbar { gap: 8px; }
        .tv-global-logo { width: clamp(150px, 48vw, 198px); min-width: 0; }
        .tv-global-logo span { font-size: clamp(30px, 8.5vw, 40px); white-space: nowrap; }
        .tv-header-actions { gap: 6px; }
        .tv-global-account { width: 92px; min-width: 86px; max-width: 108px; min-height: 42px; padding: 0 11px; font-size: clamp(12px, 3.3vw, 14px); }
        .tv-global-account.tv-account-icon { width: 38px; min-width: 38px; min-height: 38px; }
        .tv-notification-button { width: 34px; min-width: 34px; min-height: 34px; }
        .tv-global-account.tv-account-icon svg { width: 18px; height: 18px; }
        .tv-notification-button svg { width: 16px; height: 16px; }
        .tv-notification-panel { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 76px); left: 10px; right: 10px; width: auto; max-height: calc(100dvh - env(safe-area-inset-top, 0px) - 96px); }
        .tv-close { width: 42px; height: 42px; flex-basis: 42px; font-size: 26px; }
        .tv-header { flex: 0 0 auto; margin-bottom: 8px; padding: 10px 11px; align-items: center; border-radius: 11px; }
        .tv-header h1 { font-size: clamp(23px, 6.5vw, 29px); white-space: nowrap; }
        .tv-header > div > span { display: none; }
        .tv-filters { position: relative; flex: 0 0 auto; top: auto; margin-bottom: 4px; padding: 5px; gap: 3px; border-radius: 9px; }
        .tv-filters button { min-height: 38px; padding: 0 4px; font-size: 12px; }
        .tv-empty { flex: 1 1 auto; min-height: 0; margin: 4px 0; }
        .tv-feed { height: auto; min-height: 0; flex: 1 1 0; scrollbar-gutter: auto; }
        .tv-feed:empty { display: none; }
        .tv-slide { height: 100%; min-height: 100%; padding: 3px 0; }
        .tv-player { width: 100%; height: 100%; min-height: 0; max-height: none; border-radius: 16px; }
        .tv-player video { object-fit: contain; }
        .tv-profile-body { grid-template-columns: 50px minmax(0, 1fr); gap: 11px; padding: 74px 14px 16px; }
        .tv-profile-photo { width: 50px; height: 50px; font-size: 16px; }
        .tv-profile-body h2 { font-size: clamp(18px, 5.2vw, 22px); }
        .tv-card-venue-line { font-size: clamp(11px, 3.2vw, 13px); }
        .tv-card-schedule-text, .tv-no-shifts-state { font-size: clamp(11px, 3.1vw, 13px); }
      }
      @media (max-width: 374px) {
        .tv-global-logo { width: clamp(136px, 44vw, 164px); max-width: clamp(136px, 44vw, 164px); }
        .tv-global-account { width: 88px; min-width: 78px; max-width: 94px; padding-inline: 9px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .tv-feed { scroll-behavior: auto; }
      }
    `}</style>
  );
}
