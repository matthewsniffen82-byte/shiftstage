"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type PropsWithChildren,
} from "react";
import Link from "next/link";

type ShiftAction = {
  id: string;
  label: string;
  isActive?: boolean;
};

type SavedState = {
  following: boolean;
  notificationsEnabled: boolean;
  goingShiftIds: string[];
};

type AccountAction = "follow" | "notify";

const REPORT_REASONS = [
  "Misleading or inaccurate profile",
  "Impersonation",
  "Harassment or unsafe content",
  "Underage concern",
  "Spam or prohibited promotion",
  "Other safety concern",
] as const;

const SESSION_KEY = "dancrAuthSessionV1";

type DancerFollowState = {
  followerCount: number;
  setFollowerCount: (count: number) => void;
  goingCount: number;
  setGoingCount: (count: number) => void;
};

const DancerFollowStateContext = createContext<DancerFollowState | null>(null);

export function DancerFollowStateProvider({
  initialFollowerCount,
  initialGoingCount,
  children,
}: PropsWithChildren<{ initialFollowerCount: number; initialGoingCount: number }>) {
  const [followerCount, setFollowerCount] = useState(Math.max(0, initialFollowerCount));
  const [goingCount, setGoingCount] = useState(Math.max(0, initialGoingCount));
  const setConfirmedFollowerCount = useCallback((count: number) => {
    setFollowerCount(Math.max(0, count));
  }, []);
  const setConfirmedGoingCount = useCallback((count: number) => {
    setGoingCount(Math.max(0, count));
  }, []);
  const value = useMemo(
    () => ({
      followerCount,
      setFollowerCount: setConfirmedFollowerCount,
      goingCount,
      setGoingCount: setConfirmedGoingCount,
    }),
    [followerCount, setConfirmedFollowerCount, goingCount, setConfirmedGoingCount],
  );

  return <DancerFollowStateContext.Provider value={value}>{children}</DancerFollowStateContext.Provider>;
}

export function DancerFollowerCount() {
  const { followerCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(followerCount)}</>;
}

export function DancerGoingCount() {
  const { goingCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(goingCount)}</>;
}

export function DancerProfileActions({
  dancerId,
  profileName,
  shifts,
}: {
  dancerId: string;
  profileName: string;
  shifts: ShiftAction[];
}) {
  const { setFollowerCount, setGoingCount } = useDancerFollowState();
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<SavedState>({
    following: false,
    notificationsEnabled: false,
    goingShiftIds: [],
  });
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [goingSaving, setGoingSaving] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [accountRequiredAction, setAccountRequiredAction] = useState<AccountAction | null>(null);
  const [status, setStatus] = useState("");
  const actionShift = useMemo(
    () => shifts.find((shift) => shift.isActive) || shifts[0] || null,
    [shifts],
  );
  const actionShiftId = actionShift?.id || "";
  const showSignedOutRequirements = savedLoaded && !token;

  useEffect(() => {
    let active = true;
    setSavedLoaded(false);
    setStatus("");
    const accessToken = readToken();
    setToken(accessToken);
    if (!accessToken) {
      if (!actionShiftId) {
        setSavedLoaded(true);
        return () => {
          active = false;
        };
      }
      fetch(`/api/customer/going?shiftId=${encodeURIComponent(actionShiftId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
        .then((response) => response.json())
        .then((data) => {
          if (!active) return;
          if (!data.ok) throw new Error(data.error || "Unable to load going status.");
          setSaved((current) => ({
            ...current,
            goingShiftIds: data.going === true ? [actionShiftId] : [],
          }));
          setGoingCount(readConfirmedGoingCount(data));
        })
        .catch(() => {
          if (active) setStatus("Unable to load going status.");
        })
        .finally(() => {
          if (active) setSavedLoaded(true);
        });
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
  }, [actionShiftId, dancerId, setGoingCount]);

  useEffect(() => {
    if (!accountRequiredAction && !reportDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountRequiredAction(null);
      setReportDialogOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountRequiredAction, reportDialogOpen]);

  function requireCustomerAccount(action: AccountAction) {
    if (token) return true;
    setAccountRequiredAction(action);
    return false;
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
      }, "follow");
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
      }, "notify");
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
    if (!savedLoaded || goingSaving) return;
    const going = !saved.goingShiftIds.includes(shiftId);
    setGoingSaving(true);
    try {
      const data = await postGoingAction(shiftId, going);
      setSaved((current) => ({
        ...current,
        goingShiftIds: data.going === true
          ? Array.from(new Set([...current.goingShiftIds, shiftId]))
          : current.goingShiftIds.filter((id) => id !== shiftId),
      }));
      setGoingCount(readConfirmedGoingCount(data));
      setStatus(data.going === true ? "You’re going." : "Removed.");
    } catch {
      // postGoingAction displays the production API error beside the controls.
    } finally {
      setGoingSaving(false);
    }
  }

  async function postGoingAction(shiftId: string, going: boolean) {
    setStatus("");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch("/api/customer/going", {
      method: "POST",
      headers,
      body: JSON.stringify({ shiftId, going }),
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const message = data.error || "Unable to update going status.";
      setStatus(message);
      throw new Error(message);
    }
    return data;
  }

  function submitReport() {
    if (reportSaving || reportSubmitted) return;
    setReportError("");
    setReportDialogOpen(true);
  }

  async function submitReportForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reportSaving || reportSubmitted) return;
    if (!reportReason) {
      setReportError("Choose a reason for the report.");
      return;
    }
    setReportSaving(true);
    setReportError("");
    setStatus("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch("/api/reports", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          targetType: "dancer_profile",
          targetId: dancerId,
          targetLabel: profileName,
          reason: reportReason,
          details: reportDetails.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to submit report.");
      }
      if (!data.report) throw new Error("The report could not be confirmed.");
      setReportSubmitted(true);
      setReportDialogOpen(false);
      setStatus("Report submitted for review.");
    } catch (error) {
      setReportError(
        error instanceof Error ? error.message : "Unable to submit report.",
      );
    } finally {
      setReportSaving(false);
    }
  }

  async function postAction(
    path: string,
    body: Record<string, unknown>,
    action: AccountAction,
  ) {
    setStatus("");
    const response = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      if (response.status === 401) {
        setToken("");
        setAccountRequiredAction(action);
      }
      const message = data.error || "Unable to update this profile.";
      setStatus(message);
      throw new Error(message);
    }
    setStatus("Saved.");
    return data;
  }

  return (
    <>
      <div className="live-actions" aria-label="Customer actions" aria-busy={followSaving || goingSaving || reportSaving}>
        <button
          className={`profile-action-primary profile-action-public${actionShift ? "" : " profile-action-unavailable"}`}
          type="button"
          onClick={() => {
            if (actionShift) updateGoing(actionShift.id);
          }}
          disabled={!actionShift || !savedLoaded || goingSaving}
        >
          {actionShift && saved.goingShiftIds.includes(actionShift.id) ? "Going" : "I’m Going"}
          <small className="profile-action-requirement">
            {actionShift
              ? `${actionShift.isActive ? "Working now" : actionShift.label} · No sign-in needed`
              : "No shift posted"}
          </small>
        </button>
        <button
          className={`profile-action-secondary${showSignedOutRequirements ? " profile-action-requires-account" : ""}`}
          type="button"
          onClick={() => {
            if (requireCustomerAccount("follow")) updateFollow(false);
          }}
          disabled={!savedLoaded || followSaving}
        >
          {saved.following ? "Following" : "Follow"}
          {showSignedOutRequirements ? (
            <small className="profile-action-requirement">Sign in required</small>
          ) : null}
        </button>
        <button
          className={`profile-action-secondary${showSignedOutRequirements ? " profile-action-requires-account" : ""}`}
          type="button"
          onClick={() => {
            if (requireCustomerAccount("notify")) updateNotifications();
          }}
          disabled={!savedLoaded || followSaving}
        >
          {saved.notificationsEnabled ? "Notifications on" : "Notify me"}
          {showSignedOutRequirements ? (
            <small className="profile-action-requirement">Sign in required</small>
          ) : null}
        </button>
        <button
          className="profile-action-report"
          type="button"
          onClick={submitReport}
          disabled={reportSaving || reportSubmitted}
        >
          {reportSubmitted ? "Reported" : reportSaving ? "Submitting" : "Report"}
        </button>
        {status ? <span className="profile-action-status" role="status">{status}</span> : null}
      </div>
      {accountRequiredAction ? (
        <div
          className="profile-account-gate"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAccountRequiredAction(null);
          }}
        >
          <section
            className="profile-account-gate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-account-gate-title"
            aria-describedby="profile-account-gate-message"
          >
            <button
              className="profile-account-gate-close"
              type="button"
              aria-label="Close account prompt"
              autoFocus
              onClick={() => setAccountRequiredAction(null)}
            >
              ×
            </button>
            <span>Free customer account</span>
            <h2 id="profile-account-gate-title">Create an account to continue</h2>
            <p id="profile-account-gate-message">{accountActionMessage(accountRequiredAction)}</p>
            <div>
              <Link href="/account?role=customer&mode=signup">Create a free account</Link>
              <Link className="secondary" href="/account?role=customer">Already have an account? Sign in</Link>
            </div>
          </section>
        </div>
      ) : null}
      {reportDialogOpen ? (
        <div
          className="profile-report-gate"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !reportSaving) {
              setReportDialogOpen(false);
            }
          }}
        >
          <section
            aria-describedby="profile-report-message"
            aria-labelledby="profile-report-title"
            aria-modal="true"
            className="profile-report-dialog"
            role="dialog"
          >
            <button
              aria-label="Close report form"
              className="profile-report-close"
              disabled={reportSaving}
              onClick={() => setReportDialogOpen(false)}
              type="button"
            >
              ×
            </button>
            <span>Safety report</span>
            <h2 id="profile-report-title">Report {profileName}</h2>
            <p id="profile-report-message">
              Tell the moderation team what is wrong. Reports can be submitted without signing in.
            </p>
            <form onSubmit={submitReportForm}>
              <label>
                Reason
                <select
                  autoFocus
                  onChange={(event) => setReportReason(event.target.value)}
                  required
                  value={reportReason}
                >
                  <option value="">Choose a reason</option>
                  {REPORT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Details <small>Optional</small>
                <textarea
                  maxLength={1200}
                  onChange={(event) => setReportDetails(event.target.value)}
                  placeholder="Add information that will help the moderation team review this profile."
                  rows={4}
                  value={reportDetails}
                />
              </label>
              {reportError ? <p className="profile-report-error" role="alert">{reportError}</p> : null}
              <button disabled={reportSaving} type="submit">
                {reportSaving ? "Submitting report…" : "Submit report"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
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

function readConfirmedGoingCount(data: { goingCount?: unknown }) {
  const count = Number(data.goingCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("The going status was saved, but the count could not be confirmed.");
  }
  return count;
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return session?.account?.role === "customer" && typeof session?.accessToken === "string"
      ? session.accessToken
      : "";
  } catch {
    return "";
  }
}

function accountActionMessage(action: AccountAction) {
  if (action === "follow") return "Create a free customer account to follow this dancer and save the profile.";
  return "Create a free customer account to turn on dancer notifications.";
}
