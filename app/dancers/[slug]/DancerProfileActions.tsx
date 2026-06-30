"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ShiftAction = {
  id: string;
  label: string;
};

type SavedState = {
  following: boolean;
  notificationsEnabled: boolean;
  goingShiftIds: string[];
};

const SESSION_KEY = "dancrAuthSessionV1";

export function DancerProfileActions({ dancerId, shifts }: { dancerId: string; shifts: ShiftAction[] }) {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<SavedState>({
    following: false,
    notificationsEnabled: false,
    goingShiftIds: [],
  });
  const [status, setStatus] = useState("");
  const nextShift = useMemo(() => shifts[0] || null, [shifts]);

  useEffect(() => {
    const accessToken = readToken();
    setToken(accessToken);
    if (!accessToken) return;

    fetch("/api/customer/saved", { headers: { authorization: `Bearer ${accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        const follows = data.saved?.follows || [];
        const goingSignals = data.saved?.goingSignals || [];
        const follow = follows.find((item: any) => item.dancerId === dancerId);

        setSaved({
          following: Boolean(follow),
          notificationsEnabled: Boolean(follow?.notificationsEnabled),
          goingShiftIds: goingSignals.map((item: any) => item.shiftId).filter(Boolean),
        });
      })
      .catch(() => undefined);
  }, [dancerId]);

  if (!token) {
    return (
      <div className="live-actions">
        <Link href="/account?role=customer">Sign in to save</Link>
      </div>
    );
  }

  async function updateFollow(notificationsEnabled = saved.notificationsEnabled) {
    const following = !saved.following;
    await postAction("/api/customer/follows", { dancerId, following, notificationsEnabled: following && notificationsEnabled });
    setSaved((current) => ({
      ...current,
      following,
      notificationsEnabled: following ? notificationsEnabled : false,
    }));
  }

  async function updateNotifications() {
    const notificationsEnabled = !saved.notificationsEnabled;
    await postAction("/api/customer/follows", { dancerId, following: true, notificationsEnabled });
    setSaved((current) => ({ ...current, following: true, notificationsEnabled }));
  }

  async function updateGoing(shiftId: string) {
    const going = !saved.goingShiftIds.includes(shiftId);
    await postAction("/api/customer/going", { shiftId, going });
    setSaved((current) => ({
      ...current,
      goingShiftIds: going
        ? Array.from(new Set([...current.goingShiftIds, shiftId]))
        : current.goingShiftIds.filter((id) => id !== shiftId),
    }));
  }

  async function postAction(path: string, body: Record<string, unknown>) {
    setStatus("");
    const response = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const message = data.error || "Unable to update this profile.";
      setStatus(message);
      throw new Error(message);
    }
    setStatus("Saved.");
  }

  return (
    <div className="live-actions" aria-label="Customer actions">
      <button type="button" onClick={() => updateFollow(false)}>
        {saved.following ? "Following" : "Follow"}
      </button>
      <button type="button" onClick={updateNotifications}>
        {saved.notificationsEnabled ? "Notifications on" : "Notify me"}
      </button>
      {nextShift ? (
        <button type="button" onClick={() => updateGoing(nextShift.id)}>
          {saved.goingShiftIds.includes(nextShift.id) ? "Going" : `Going ${nextShift.label}`}
        </button>
      ) : null}
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
