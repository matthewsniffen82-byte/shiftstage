"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  readBrowserAuthSession,
  type BrowserAuthSession,
  type BrowserSessionRole,
} from "@/src/lib/dancr/browser-session";

type HeaderNotification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
};

export function PublicProfileHeader({
  city,
  closeControl,
}: {
  city: string;
  closeControl: ReactNode;
}) {
  const [session, setSession] = useState<BrowserAuthSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const actionsRef = useRef<HTMLDivElement | null>(null);

  const role = session?.account?.role;
  const accessToken = session?.accessToken || "";
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  );

  useEffect(() => {
    const nextSession = readBrowserAuthSession();
    setSession(nextSession);
    setSessionLoaded(true);
    if (!nextSession?.accessToken || !nextSession.account?.role) return;

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
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  async function markNotificationRead(notificationId: string) {
    if (!accessToken) return;
    setNotificationStatus("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${accessToken}`,
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
            ? {
                ...notification,
                readAt: data.notification?.readAt || new Date().toISOString(),
              }
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
    if (!accessToken) return;
    setNotificationStatus("");
    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
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

  return (
    <header className="profile-global-header">
      <div className="profile-global-topbar">
        <Link className="profile-global-logo" href="/" aria-label="Go to mydancr home">
          mydanc<span>r</span>
        </Link>
        <span className="profile-global-city">{city}</span>
        <div className="profile-global-actions" ref={actionsRef}>
          {role && accessToken ? (
            <button
              aria-controls="profile-notification-panel"
              aria-expanded={notificationsOpen}
              aria-label="Open notifications"
              className={notificationsOpen ? "profile-notification-button active" : "profile-notification-button"}
              onClick={() => setNotificationsOpen((current) => !current)}
              type="button"
            >
              <BellIcon />
              {unreadCount ? (
                <span className="profile-notification-count">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {role ? (
            <Link
              aria-label={`Open ${role} dashboard`}
              className="profile-global-account profile-account-icon"
              href={dashboardHref(role)}
              title={`${capitalize(role)} dashboard`}
            >
              <AccountIcon />
            </Link>
          ) : sessionLoaded ? (
            <Link className="profile-global-account" href="/account">
              Login / Join
            </Link>
          ) : null}
          {closeControl}
          {role && notificationsOpen ? (
            <section
              aria-label="Notifications"
              className="profile-notification-panel"
              id="profile-notification-panel"
            >
              <div className="profile-notification-head">
                <div>
                  <strong>Notifications</strong>
                  <span>{unreadCount} unread</span>
                </div>
                <Link href={dashboardHref(role)}>Open dashboard</Link>
              </div>
              <div className="profile-notification-list">
                {notificationsLoading ? <p>Loading notifications…</p> : null}
                {!notificationsLoading && !notifications.length ? (
                  <p>No notifications yet.</p>
                ) : null}
                {notifications.slice(0, 8).map((notification) => (
                  <button
                    className={notification.readAt ? "read" : ""}
                    key={notification.id}
                    onClick={() => markNotificationRead(notification.id)}
                    type="button"
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                  </button>
                ))}
              </div>
              {notifications.length ? (
                <button
                  className="profile-notification-clear"
                  onClick={clearNotifications}
                  type="button"
                >
                  Clear notifications
                </button>
              ) : null}
              {notificationStatus ? (
                <p className="profile-notification-status" role="status">
                  {notificationStatus}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function normalizeNotifications(value: unknown): HeaderNotification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const notification = item as Record<string, unknown>;
    const id = typeof notification.id === "string" ? notification.id : "";
    if (!id) return [];
    return [
      {
        id,
        title:
          typeof notification.title === "string" && notification.title.trim()
            ? notification.title.trim()
            : "Notification",
        body:
          typeof notification.body === "string"
            ? notification.body.trim()
            : "",
        readAt:
          typeof notification.readAt === "string" ? notification.readAt : null,
      },
    ];
  });
}

function dashboardHref(role: BrowserSessionRole) {
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
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
