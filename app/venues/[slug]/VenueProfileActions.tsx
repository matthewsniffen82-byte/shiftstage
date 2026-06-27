"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SESSION_KEY = "dancrAuthSessionV1";

export function VenueProfileActions({ venueId }: { venueId: string }) {
  const [token, setToken] = useState("");
  const [following, setFollowing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [status, setStatus] = useState("");

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
    const nextFollowing = !following;
    await postVenueFollow(nextFollowing, nextFollowing && nextNotificationsEnabled);
    setFollowing(nextFollowing);
    setNotificationsEnabled(nextFollowing ? nextNotificationsEnabled : false);
  }

  async function updateNotifications() {
    const nextNotificationsEnabled = !notificationsEnabled;
    await postVenueFollow(true, nextNotificationsEnabled);
    setFollowing(true);
    setNotificationsEnabled(nextNotificationsEnabled);
  }

  async function postVenueFollow(nextFollowing: boolean, nextNotificationsEnabled: boolean) {
    setStatus("");
    const response = await fetch("/api/customer/venue-follows", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        venueId,
        following: nextFollowing,
        notificationsEnabled: nextNotificationsEnabled,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const message = data.error || "Unable to update venue.";
      setStatus(message);
      throw new Error(message);
    }
    setStatus("Saved.");
  }

  return (
    <div className="live-actions" aria-label="Venue actions">
      <button type="button" onClick={() => updateFollow(false)}>
        {following ? "Following venue" : "Follow venue"}
      </button>
      <button type="button" onClick={updateNotifications}>
        {notificationsEnabled ? "Venue alerts on" : "Venue alerts"}
      </button>
      {status ? <span>{status}</span> : null}
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
