"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type SavedVenueFollow = {
  venueId?: string;
  notificationsEnabled?: boolean;
};

export function VenueProfileActions({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const [token, setToken] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [accountGateOpen, setAccountGateOpen] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const accessToken = readCustomerToken();
    setToken(accessToken);
    setSessionLoaded(true);
    if (!accessToken) return;

    const controller = new AbortController();
    fetch("/api/customer/saved", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Unable to load your saved venues.");
        }
        const follow = (data.saved?.venueFollows || []).find(
          (item: SavedVenueFollow) => item.venueId === venueId,
        );
        setFollowing(Boolean(follow));
        setNotificationsEnabled(Boolean(follow?.notificationsEnabled));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(
          error instanceof Error
            ? error.message
            : "Unable to load your saved venues.",
        );
      });

    return () => controller.abort();
  }, [venueId]);

  async function shareVenue() {
    setStatus("");
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${venueName} on mydancr`,
          text: `See who's working at ${venueName} on mydancr.`,
          url,
        });
        setStatus("Venue shared.");
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Venue link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Unable to share this venue.");
    }
  }

  async function updateFollow() {
    if (!requireCustomer() || isSaving) return;
    const nextFollowing = !following;
    const saved = await saveVenueFollow(
      nextFollowing,
      nextFollowing && notificationsEnabled,
    );
    if (!saved) return;
    setFollowing(nextFollowing);
    setNotificationsEnabled(nextFollowing ? notificationsEnabled : false);
    setStatus(nextFollowing ? "Venue followed." : "Venue unfollowed.");
  }

  async function updateNotifications() {
    if (!requireCustomer() || isSaving) return;
    const nextNotificationsEnabled = !notificationsEnabled;
    const saved = await saveVenueFollow(true, nextNotificationsEnabled);
    if (!saved) return;
    setFollowing(true);
    setNotificationsEnabled(nextNotificationsEnabled);
    setStatus(nextNotificationsEnabled ? "Venue alerts turned on." : "Venue alerts turned off.");
  }

  function requireCustomer() {
    if (token) return true;
    setAccountGateOpen(true);
    return false;
  }

  async function saveVenueFollow(
    nextFollowing: boolean,
    nextNotificationsEnabled: boolean,
  ) {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/customer/venue-follows", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          venueId,
          following: nextFollowing,
          notificationsEnabled: nextNotificationsEnabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        if (response.status === 401 || response.status === 403) {
          setToken("");
          setAccountGateOpen(true);
        }
        throw new Error(data.error || "Unable to update this venue.");
      }
      if (
        data.following !== nextFollowing ||
        data.notificationsEnabled !==
          (nextFollowing && nextNotificationsEnabled)
      ) {
        throw new Error("The venue update could not be confirmed.");
      }
      return true;
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to update this venue. Please try again.",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  if (!sessionLoaded) {
    return <div className="venue-actions-loading" aria-label="Loading venue actions" />;
  }

  return (
    <>
      <div className="venue-profile-actions" aria-busy={isSaving}>
        <button
          aria-pressed={following}
          disabled={isSaving}
          onClick={updateFollow}
          type="button"
        >
          {isSaving ? "Saving…" : following ? "Following" : "Follow venue"}
        </button>
        <button
          aria-pressed={notificationsEnabled}
          disabled={isSaving}
          onClick={updateNotifications}
          type="button"
        >
          {notificationsEnabled ? "Alerts on" : "Venue alerts"}
        </button>
        <button onClick={shareVenue} type="button">
          Share
        </button>
        {status ? <span role="status">{status}</span> : null}
      </div>

      {accountGateOpen ? (
        <div
          className="venue-account-gate"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAccountGateOpen(false);
          }}
        >
          <section
            aria-labelledby="venue-account-gate-title"
            aria-modal="true"
            className="venue-account-gate-dialog"
            role="dialog"
          >
            <button
              aria-label="Close account prompt"
              autoFocus
              className="venue-account-gate-close"
              onClick={() => setAccountGateOpen(false)}
              type="button"
            >
              ×
            </button>
            <span>Free customer account</span>
            <h2 id="venue-account-gate-title">Save this venue</h2>
            <p>Use a customer account to follow venues and receive schedule alerts.</p>
            <div>
              <Link href="/account?role=customer&mode=signup">Create a free account</Link>
              <Link className="secondary" href="/account?role=customer">
                Sign in
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function readCustomerToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return session?.account?.role === "customer" &&
      typeof session?.accessToken === "string"
      ? session.accessToken
      : "";
  } catch {
    return "";
  }
}
