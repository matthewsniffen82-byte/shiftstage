"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import Link from "next/link";
import { PublicReportReasonDialog, type PublicReportReason } from "@/app/components/PublicReportReasonDialog";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";

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

type AccountAction = "follow";

type DancerFollowState = {
  followerCount: number;
  setFollowerCount: (count: number) => void;
  notificationCount: number;
  setNotificationCount: (count: number) => void;
  goingCount: number;
  setGoingCount: (count: number) => void;
};

const DancerFollowStateContext = createContext<DancerFollowState | null>(null);

export function DancerFollowStateProvider({
  initialFollowerCount,
  initialNotificationCount,
  initialGoingCount,
  children,
}: PropsWithChildren<{
  initialFollowerCount: number;
  initialNotificationCount: number;
  initialGoingCount: number;
}>) {
  const [followerCount, setFollowerCount] = useState(Math.max(0, initialFollowerCount));
  const [notificationCount, setNotificationCount] = useState(
    Math.max(0, initialNotificationCount),
  );
  const [goingCount, setGoingCount] = useState(Math.max(0, initialGoingCount));
  const setConfirmedFollowerCount = useCallback((count: number) => {
    setFollowerCount(Math.max(0, count));
  }, []);
  const setConfirmedGoingCount = useCallback((count: number) => {
    setGoingCount(Math.max(0, count));
  }, []);
  const setConfirmedNotificationCount = useCallback((count: number) => {
    setNotificationCount(Math.max(0, count));
  }, []);
  const value = useMemo(
    () => ({
      followerCount,
      setFollowerCount: setConfirmedFollowerCount,
      notificationCount,
      setNotificationCount: setConfirmedNotificationCount,
      goingCount,
      setGoingCount: setConfirmedGoingCount,
    }),
    [
      followerCount,
      setConfirmedFollowerCount,
      notificationCount,
      setConfirmedNotificationCount,
      goingCount,
      setConfirmedGoingCount,
    ],
  );

  return <DancerFollowStateContext.Provider value={value}>{children}</DancerFollowStateContext.Provider>;
}

export function DancerFollowerCount() {
  const { followerCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(followerCount)}</>;
}

export function DancerFollowerMetric() {
  const { followerCount } = useDancerFollowState();
  return (
    <>
      <dd>{new Intl.NumberFormat("en-US").format(followerCount)}</dd>
      <dt>{followerCount === 1 ? "Follower" : "Followers"}</dt>
    </>
  );
}

export function DancerGoingCount() {
  const { goingCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(goingCount)}</>;
}

function DancerProfileActionPreviewIcon({
  type,
}: {
  type: "check" | "clock" | "personPlus" | "share";
}) {
  return (
    <span aria-hidden="true" className="profile-action-icon-frame" data-profile-action-icon={type}>
      <svg className={`profile-action-preview-icon profile-action-preview-icon-${type}`} viewBox="0 0 24 24">
        {type === "personPlus" ? <><circle cx="8.5" cy="7.5" r="3.5" /><path d="M3 20a5.5 5.5 0 0 1 11 0M18 8.5v6M15 11.5h6" /></> : null}
        {type === "check" ? <path d="m5 12 4 4L19 6" /> : null}
        {type === "clock" ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3.2 2" /></> : null}
        {type === "share" ? <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4" /></> : null}
      </svg>
    </span>
  );
}

function ReportFlagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 21V4" />
      <path d="M5 5h11l-1.8 3L16 11H5" />
    </svg>
  );
}

export function DancerProfileActionsPreview({ onShare }: { onShare?: () => void }) {
  return (
    <div className="live-actions is-no-live-shift dancer-profile-preview-actions" aria-label="Guest actions">
      <button className="profile-action-secondary profile-action-icon-control profile-action-preview-static" disabled type="button">
        <span className="profile-action-main"><DancerProfileActionPreviewIcon type="personPlus" /><span>Follow</span></span>
      </button>
      <button aria-disabled="true" className="profile-action-secondary profile-action-going profile-action-icon-control profile-action-unavailable profile-action-preview-static" disabled type="button">
        <span className="profile-action-main"><DancerProfileActionPreviewIcon type="clock" /><span>I’m Going</span></span>
      </button>
      <div className="profile-action-share-slot">
        <span className="profile-share">
          <button className="profile-action-preview-share profile-action-icon-control" disabled={!onShare} onClick={onShare} type="button">
            <span className="profile-action-main"><DancerProfileActionPreviewIcon type="share" /><span>Share</span></span>
          </button>
        </span>
      </div>
      <button aria-label="Report profile" className="profile-report-action profile-action-preview-static" disabled type="button"><ReportFlagIcon /></button>
    </div>
  );
}

export function DancerNotificationCount() {
  const { notificationCount } = useDancerFollowState();
  return <>{new Intl.NumberFormat("en-US").format(notificationCount)}</>;
}

export function DancerReportControl({
  dancerId,
  profileName,
}: {
  dancerId: string;
  profileName: string;
}) {
  const [reportSaving, setReportSaving] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportError, setReportError] = useState("");
  const mountedRef = useRef(false);
  const reportAbortRef = useRef<AbortController | null>(null);
  const reportInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reportAbortRef.current?.abort();
      reportInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!reportDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !reportSaving) setReportDialogOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [reportDialogOpen, reportSaving]);

  function openReport() {
    if (reportSaving || reportSubmitted) return;
    setReportError("");
    setReportDialogOpen(true);
  }

  async function submitReport(reason: PublicReportReason) {
    if (reportInFlightRef.current || reportSubmitted) return;
    const controller = new AbortController();
    reportAbortRef.current?.abort();
    reportAbortRef.current = controller;
    reportInFlightRef.current = true;
    setReportSaving(true);
    setReportError("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const accessToken = readBrowserAccessToken("customer");
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      const response = await fetch("/api/reports", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          targetType: "dancer_profile",
          targetId: dancerId,
          targetLabel: profileName,
          reason,
          details: null,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to submit report.");
      }
      if (!data.report) throw new Error("The report could not be confirmed.");
      setReportSubmitted(true);
      setReportDialogOpen(false);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setReportError(
        error instanceof Error ? error.message : "Unable to submit report.",
      );
    } finally {
      if (reportAbortRef.current === controller) {
        reportAbortRef.current = null;
        reportInFlightRef.current = false;
        if (mountedRef.current) setReportSaving(false);
      }
    }
  }

  return (
    <div className="profile-header-report">
      <button
        aria-label={reportSubmitted ? "Profile reported" : "Report profile"}
        aria-pressed={reportSubmitted}
        className="profile-header-report-toggle"
        disabled={reportSaving || reportSubmitted}
        onClick={openReport}
        type="button"
      >
        <ReportFlagIcon />
      </button>
      {reportSubmitted ? (
        <span className="profile-report-confirmation" role="status">Report submitted for review.</span>
      ) : null}
      {reportDialogOpen ? (
        <PublicReportReasonDialog
          error={reportError}
          onClose={() => setReportDialogOpen(false)}
          onReason={(reason) => void submitReport(reason)}
          saving={reportSaving}
          title="Report profile"
          titleId="profile-report-title"
        />
      ) : null}
    </div>
  );
}

export function DancerProfileActions({
  dancerId,
  shifts,
  shareControl,
}: {
  dancerId: string;
  shifts: ShiftAction[];
  shareControl?: ReactNode;
}) {
  const {
    setFollowerCount,
    setNotificationCount,
    setGoingCount,
  } = useDancerFollowState();
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<SavedState>({
    following: false,
    notificationsEnabled: false,
    goingShiftIds: [],
  });
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [goingSaving, setGoingSaving] = useState(false);
  const [accountRequiredAction, setAccountRequiredAction] = useState<AccountAction | null>(null);
  const [status, setStatus] = useState("");
  const mountedRef = useRef(false);
  const followAbortRef = useRef<AbortController | null>(null);
  const followInFlightRef = useRef(false);
  const goingAbortRef = useRef<AbortController | null>(null);
  const goingInFlightRef = useRef(false);
  const actionShift = useMemo(
    () => shifts.find((shift) => shift.isActive) || shifts[0] || null,
    [shifts],
  );
  const actionShiftId = actionShift?.id || "";
  const hasLiveActions = Boolean(actionShift?.isActive);
  const hasScheduledActions = Boolean(actionShift);
  const isGoing = Boolean(actionShift && saved.goingShiftIds.includes(actionShift.id));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      followAbortRef.current?.abort();
      followInFlightRef.current = false;
      goingAbortRef.current?.abort();
      goingInFlightRef.current = false;
    };
  }, [actionShiftId, dancerId]);

  useEffect(() => {
    const controller = new AbortController();
    setSavedLoaded(false);
    setStatus("");
    const accessToken = readBrowserAccessToken("customer");
    setToken(accessToken);
    if (!accessToken) {
      if (!actionShiftId) {
        setSavedLoaded(true);
        return () => controller.abort();
      }
      fetch(`/api/customer/going?shiftId=${encodeURIComponent(actionShiftId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          if (!data.ok) throw new Error(data.error || "Unable to load going status.");
          setSaved((current) => ({
            ...current,
            goingShiftIds: data.going === true ? [actionShiftId] : [],
          }));
          setGoingCount(readConfirmedGoingCount(data));
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("Unable to load going status.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSavedLoaded(true);
        });
      return () => controller.abort();
    }

    fetch("/api/customer/saved", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        if (controller.signal.aborted) return;
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
        if (!controller.signal.aborted) setStatus("Unable to load saved profile actions.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSavedLoaded(true);
      });

    return () => controller.abort();
  }, [actionShiftId, dancerId, setGoingCount]);

  useEffect(() => {
    if (!accountRequiredAction) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountRequiredAction(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountRequiredAction]);

  function requireCustomerAccount(action: AccountAction) {
    if (token) return true;
    setAccountRequiredAction(action);
    return false;
  }

  async function updateFollow() {
    if (!mountedRef.current || !savedLoaded || followInFlightRef.current) return;
    const controller = new AbortController();
    followAbortRef.current?.abort();
    followAbortRef.current = controller;
    followInFlightRef.current = true;
    const previousFollowing = saved.following;
    const requestedFollowing = !previousFollowing;
    setFollowSaving(true);

    try {
      const data = await postAction("/api/customer/follows", {
        dancerId,
        following: requestedFollowing,
        notificationsEnabled: requestedFollowing,
      }, "follow", controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      const following = typeof data.following === "boolean" ? data.following : requestedFollowing;
      const savedNotificationsEnabled = following && data.notificationsEnabled === true;
      const confirmedFollowerCount = readConfirmedFollowerCount(data);
      const confirmedNotificationCount = readConfirmedNotificationCount(data);

      setSaved((current) => ({
        ...current,
        following,
        notificationsEnabled: savedNotificationsEnabled,
      }));
      setFollowerCount(confirmedFollowerCount);
      setNotificationCount(confirmedNotificationCount);
    } catch {
      // postAction displays the production API error beside the controls.
    } finally {
      if (followAbortRef.current === controller) {
        followAbortRef.current = null;
        followInFlightRef.current = false;
        if (mountedRef.current) setFollowSaving(false);
      }
    }
  }

  async function updateGoing(shiftId: string) {
    if (!mountedRef.current || !savedLoaded || goingInFlightRef.current) return;
    const controller = new AbortController();
    goingAbortRef.current?.abort();
    goingAbortRef.current = controller;
    goingInFlightRef.current = true;
    const going = !saved.goingShiftIds.includes(shiftId);
    setGoingSaving(true);
    try {
      const data = await postGoingAction(shiftId, going, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
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
      if (goingAbortRef.current === controller) {
        goingAbortRef.current = null;
        goingInFlightRef.current = false;
        if (mountedRef.current) setGoingSaving(false);
      }
    }
  }

  async function postGoingAction(shiftId: string, going: boolean, signal: AbortSignal) {
    setStatus("");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch("/api/customer/going", {
      method: "POST",
      headers,
      body: JSON.stringify({ shiftId, going }),
      credentials: "same-origin",
      signal,
    });
    const data = await response.json();
    if (!mountedRef.current || signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response.ok || !data.ok) {
      const message = data.error || "Unable to update going status.";
      setStatus(message);
      throw new Error(message);
    }
    return data;
  }

  async function postAction(
    path: string,
    body: Record<string, unknown>,
    action: AccountAction,
    signal: AbortSignal,
  ) {
    setStatus("");
    const response = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!mountedRef.current || signal.aborted) throw new DOMException("Aborted", "AbortError");
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
      <div className={`live-actions${hasLiveActions ? " has-live-shift" : hasScheduledActions ? " has-upcoming-shift" : " is-no-live-shift"}`} aria-label="Guest actions" aria-busy={followSaving || goingSaving}>
        <button
          aria-pressed={saved.following}
          className={`profile-action-secondary profile-action-icon-control${saved.following ? " is-selected" : ""}`}
          type="button"
          onClick={() => {
            if (requireCustomerAccount("follow")) updateFollow();
          }}
          disabled={!savedLoaded || followSaving}
        >
          <span className="profile-action-main">
            <DancerProfileActionPreviewIcon type={saved.following ? "check" : "personPlus"} />
            <span>{saved.following ? "Following" : "Follow"}</span>
          </span>
        </button>
        <button
          aria-disabled={!actionShift ? "true" : undefined}
          aria-label={actionShift ? (isGoing ? "Remove this shift from your plans" : "Add this shift to your plans") : "I’m Going unavailable until a shift is posted"}
          aria-pressed={actionShift ? isGoing : undefined}
          className={`${actionShift ? "profile-action-available" : "profile-action-secondary"} profile-action-going profile-action-icon-control${isGoing ? " is-going" : ""}${!actionShift ? " profile-action-unavailable" : ""}`}
          disabled={actionShift ? !savedLoaded || goingSaving : true}
          onClick={() => actionShift && updateGoing(actionShift.id)}
          type="button"
        >
          <span className="profile-action-main">
            <DancerProfileActionPreviewIcon type={isGoing ? "check" : "clock"} />
            <span>{isGoing ? "Going" : "I’m Going"}</span>
          </span>
        </button>
        {shareControl ? (
          <div className="profile-action-share-slot">{shareControl}</div>
        ) : (
          <button className="profile-action-secondary profile-action-unavailable" disabled type="button">Share</button>
        )}
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
            <span>FREE GUEST ACCOUNT</span>
            <h2 id="profile-account-gate-title">Follow your favorites</h2>
            <p id="profile-account-gate-message">{accountActionMessage()}</p>
            <div>
              <Link href="/account?role=customer&mode=signup">Create free account</Link>
              <Link className="secondary" href="/account?role=customer">Already have an account? Sign in</Link>
            </div>
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

function readConfirmedNotificationCount(data: { notificationCount?: unknown }) {
  const count = Number(data.notificationCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "The notification preference was saved, but its count could not be confirmed.",
    );
  }
  return count;
}

function accountActionMessage() {
  return "Create a free account to follow dancers, save profiles, and get updates.";
}
