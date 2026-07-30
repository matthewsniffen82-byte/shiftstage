"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SESSION_KEY = "dancrAuthSessionV1";

export function VenueProfileActions({ venueId }: { venueId: string }) {
  const [token, setToken] = useState("");
  const [following, setFollowing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const accessToken = readToken();
    setToken(accessToken);
    if (!accessToken) return;

    fetch("/api/customer/saved", { headers: { authorization: `Bearer ${accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        const follow = (data.saved?.venueFollows || []).find((item: any) => item.venueId === venueId);
        setFollowing(Boolean(follow));
        setNotificationsEnabled(Boolean(follow?.notificationsEnabled));
      })
      .catch(() => undefined);
  }, [venueId]);

  if (!token) {
    return (
      <div className="live-actions">
        <Link href="/account?role=customer">Sign in to follow</Link>
      </div>
    );
  }

  async function updateFollow(nextNotificationsEnabled = notificationsEnabled) {
    if (isSaving) return;
    const nextFollowing = !following;
    const saved = await postVenueFollow(nextFollowing, nextFollowing && nextNotificationsEnabled);
    if (saved) {
      setFollowing(nextFollowing);
      setNotificationsEnabled(nextFollowing ? nextNotificationsEnabled : false);
    }
  }

  async function updateNotifications() {
    if (isSaving) return;
    const nextNotificationsEnabled = !notificationsEnabled;
    const saved = await postVenueFollow(true, nextNotificationsEnabled);
    if (saved) {
      setFollowing(true);
      setNotificationsEnabled(nextNotificationsEnabled);
    }
  }

  async function postVenueFollow(nextFollowing: boolean, nextNotificationsEnabled: boolean) {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/customer/venue-follows", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          following: nextFollowing,
          notificationsEnabled: nextNotificationsEnabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setStatus(data.error || "Unable to update this venue. Please try again.");
        return false;
      }
      setStatus("Saved.");
      return true;
    } catch {
      setStatus("Unable to update this venue. Check your connection and try again.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="live-actions" aria-label="Venue actions">
      <button type="button" disabled={isSaving} onClick={() => updateFollow(false)}>
        {isSaving ? "Saving…" : following ? "Following venue" : "Follow venue"}
      </button>
      <button type="button" disabled={isSaving} onClick={updateNotifications}>
        {notificationsEnabled ? "Venue alerts on" : "Venue alerts"}
      </button>
      {status ? <span role="status">{status}</span> : null}
    </div>
  );
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return typeof session?.accessToken === "string" ? session.accessToken : "";
  } catch {
    return "";
  }
}
