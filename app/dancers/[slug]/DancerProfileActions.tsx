"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
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

type DancerFollowState = {
  followerCount: number;
  setFollowerCount: (count: number) => void;
};

const DancerFollowStateContext = createContext<DancerFollowState | null>(null);

export function DancerFollowStateProvider({
  initialFollowerCount,
  children,
}: PropsWithChildren<{ initialFollowerCount: number }>) {
  const [followerCount, setFollowerCount] = useState(Math.max(0, initialFollowerCount));
  const setConfirmedFollowerCount = useCallback((count: number) => {
    setFollowerCount(Math.max(0, count));
  }, []);
  const value = useMemo(
    () => ({ followerCount, setFollowerCount: setConfirmedFollowerCount }),
    [followerCount, setConfirmedFollowerCount],
  );

  return <DancerFollowStateContext.Provider value={value}>{children}</DancerFollowStateContext.Provider>;
}

export function DancerFollowerCount() {
  const { followerCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(followerCount)}</>;
}

export function DancerProfileActions({ dancerId, shifts }: { dancerId: string; shifts: ShiftAction[] }) {
  const { setFollowerCount } = useDancerFollowState();
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<SavedState>({
    following: false,
    notificationsEnabled: false,
    goingShiftIds: [],
  });
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [status, setStatus] = useState("");
  const nextShift = useMemo(() => shifts[0] || null, [shifts]);

  useEffect(() => {
    let active = true;
    setSavedLoaded(false);
    setStatus("");
    const accessToken = readToken();
    setToken(accessToken);
    if (!accessToken) {
      setSavedLoaded(true);
      return () => {
        active = false;
      };
    }

    fetch("/api/customer/saved", { headers: { authorization: `Bearer ${accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        if (!data.ok) throw new Error(data.error || "Unable to load saved profile actions.");
        const follows = data.saved?.follows || [];
        const goingSignals = data.saved?.goingSignals || [];
        const follow = follows.find((item: any) => item.dancerId === dancerId);

        setSaved({
          following: Boolean(follow),
          notificationsEnabled: Boolean(follow?.notificationsEnabled),
          goingShiftIds: goingSignals.map((item: any) => item.shiftId).filter(Boolean),
        });
      })
      .catch(() => {
        if (active) setStatus("Unable to load saved profile actions.");
      })
      .finally(() => {
        if (active) setSavedLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [dancerId]);

  if (!token) {
    return (
      <div className="live-actions">
        <Link href="/account?role=customer">Sign in to save</Link>
      </div>
    );
  }

  async function updateFollow(notificationsEnabled = saved.notificationsEnabled) {
    if (!savedLoaded || followSaving) return;
    const previousFollowing = saved.following;
    const requestedFollowing = !previousFollowing;
    setFollowSaving(true);

    try {
      const data = await postAction("/api/customer/follows", {
        dancerId,
        following: requestedFollowing,
        notificationsEnabled: requestedFollowing && notificationsEnabled,
      });
      const following = typeof data.following === "boolean" ? data.following : requestedFollowing;
      const savedNotificationsEnabled = following && data.notificationsEnabled === true;
      const confirmedFollowerCount = readConfirmedFollowerCount(data);

      setSaved((current) => ({
        ...current,
        following,
        notificationsEnabled: savedNotificationsEnabled,
      }));
      setFollowerCount(confirmedFollowerCount);
    } catch {
      // postAction displays the production API error beside the controls.
    } finally {
      setFollowSaving(false);
    }
  }

  async function updateNotifications() {
    if (!savedLoaded || followSaving) return;
    const requestedNotificationsEnabled = !saved.notificationsEnabled;
    setFollowSaving(true);

    try {
      const data = await postAction("/api/customer/follows", {
        dancerId,
        following: true,
        notificationsEnabled: requestedNotificationsEnabled,
      });
      const following = typeof data.following === "boolean" ? data.following : true;
      const notificationsEnabled = following && data.notificationsEnabled === true;
      const confirmedFollowerCount = readConfirmedFollowerCount(data);

      setSaved((current) => ({ ...current, following, notificationsEnabled }));
      setFollowerCount(confirmedFollowerCount);
    } catch {
      // postAction displays the production API error beside the controls.
    } finally {
      setFollowSaving(false);
    }
  }

  async function updateGoing(shiftId: string) {
    const going = !saved.goingShiftIds.includes(shiftId);
    try {
      await postAction("/api/customer/going", { shiftId, going });
      setSaved((current) => ({
        ...current,
        goingShiftIds: going
          ? Array.from(new Set([...current.goingShiftIds, shiftId]))
          : current.goingShiftIds.filter((id) => id !== shiftId),
      }));
    } catch {
      // postAction displays the production API error beside the controls.
    }
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
    return data;
  }

  return (
    <div className="live-actions" aria-label="Customer actions" aria-busy={followSaving}>
      <button type="button" onClick={() => updateFollow(false)} disabled={!savedLoaded || followSaving}>
        {saved.following ? "Following" : "Follow"}
      </button>
      <button type="button" onClick={updateNotifications} disabled={!savedLoaded || followSaving}>
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

function useDancerFollowState() {
  const context = useContext(DancerFollowStateContext);
  if (!context) {
    throw new Error("Dancer follow controls must be rendered inside DancerFollowStateProvider.");
  }
  return context;
}

function readConfirmedFollowerCount(data: { followerCount?: unknown }) {
  const count = Number(data.followerCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("The follow was saved, but the follower count could not be confirmed.");
  }
  return count;
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return typeof session?.accessToken === "string" ? session.accessToken : "";
  } catch {
    return "";
  }
}
