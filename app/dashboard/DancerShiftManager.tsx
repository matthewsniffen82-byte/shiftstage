"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatExternalHours } from "@/src/lib/dancr/external-ranking-progress";
import {
  isActiveNfcPresence,
  isNfcPresenceNearExpiry,
  isNfcTapCooldownActive,
  nfcNextTapAllowedAt,
  nfcPresenceMinutesRemaining,
} from "@/src/lib/dancr/shift-presence";
import {
  DashboardDataRequestError,
  requestDancerShiftCheckInJson,
  requestDancerShiftsJson,
  requestDashboardJson,
} from "./dashboard-session";

type ShiftRow = Record<string, any>;

export default function DancerShiftManager({ onPresenceChange, onVisibilityChange }: {
  onPresenceChange?: (key: string) => void; onVisibilityChange?: () => Promise<void>;
} = {}) {
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [workingNowStatus, setWorkingNowStatus] = useState("");
  const [workingNowStatusKind, setWorkingNowStatusKind] = useState<"" | "error" | "success">("");
  const [presenceClock, setPresenceClock] = useState(() => Date.now());
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionPendingRef = useRef(false);

  const load = useCallback(async () => {
    if (!mountedRef.current) return false;
    const requestId = ++loadSequenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const data = await requestDancerShiftsJson({
        cache: "no-store",
        fallbackMessage: "Unable to load shifts.",
        signal: controller.signal,
      });
      if (!mountedRef.current || requestId !== loadSequenceRef.current) return false;
      setShifts(Array.isArray(data.shifts) ? data.shifts : []);
      setHasLoaded(true);
      setStatus("");
      return true;
    } catch (error) {
      if (!mountedRef.current || requestId !== loadSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return false;
      throw error;
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load().catch((error) => {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : "Unable to load shifts.");
    });
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setPresenceClock(Date.now());
      if (!actionPendingRef.current) {
        void load().catch(() => { /* Keep the current status until the next refresh. */ });
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const activeShift = useMemo(
    () => shifts.find((shift) => isActiveNfcPresence(shift, presenceClock)) || null,
    [shifts, presenceClock],
  );
  const activeUntil = activeShift?.location_verification_expires_at || activeShift?.locationVerificationExpiresAt;
  useEffect(() => {
    if (!activeUntil) return;
    // Expire the live ring even if the next network refresh fails.
    const timer = window.setTimeout(() => setPresenceClock(Date.now()), Math.max(0, Date.parse(activeUntil) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [activeUntil]);
  const demoManagedActiveShift = activeShift?.shift_source === "demo_locked";
  const rhinoShift = ["260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af", "11fd5e46-d24f-4a02-87f6-2aa18b0876ae"].includes(activeShift?.venue_id);
  const progress = activeShift?.rankingProgress;
  const hasRecordedExternalTime = typeof progress?.externalHours === "number" && Number.isFinite(progress.externalHours) && progress.externalHours >= 0;
  const presenceKey = activeShift ? `${activeShift.id}:${activeShift.checked_in_at}:${activeShift.location_verification_expires_at}:${progress?.visibility || ""}` : "off";
  useEffect(() => {
    if (hasLoaded) onPresenceChange?.(presenceKey);
  }, [hasLoaded, presenceKey, onPresenceChange]);
  useEffect(() => () => onPresenceChange?.("off"), [onPresenceChange]);
  const latestNfcShift = useMemo(
    () => shifts
      .filter((shift) => Boolean(shift.nfc_last_tapped_at || shift.nfcLastTappedAt))
      .sort((left, right) => Date.parse(String(right.nfc_last_tapped_at || right.nfcLastTappedAt || 0))
        - Date.parse(String(left.nfc_last_tapped_at || left.nfcLastTappedAt || 0)))[0] || null,
    [shifts],
  );
  const cooldownShift = latestNfcShift && isNfcTapCooldownActive(latestNfcShift) ? latestNfcShift : null;
  async function switchToBoth() {
    if (!activeShift?.id || actionPendingRef.current) return;
    actionPendingRef.current = true;
    setSwitching(true);
    setEndConfirmationOpen(false);
    setWorkingNowStatusKind("");
    setWorkingNowStatus("Switching to Both…");
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    try {
      await requestDashboardJson("/api/dancer/shifts/visibility", {
        method: "PATCH", expectedRole: "dancer", headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId: activeShift.id }), fallbackMessage: "Unable to switch to Both.",
      });
      if (!mountedRef.current) return;
      setShifts(current => current.map(shift => shift.id === activeShift.id
        ? { ...shift, rankingProgress: { ...shift.rankingProgress, visibility: "both" } } : shift));
      setWorkingNowStatusKind("success");
      setWorkingNowStatus("Both is on. External time is now recording. Your shift still ends at the same time.");
      try {
        await Promise.all([load(), onVisibilityChange?.()]);
      } catch {
        if (mountedRef.current) setWorkingNowStatus("Both is on. Refresh the dashboard to update your recorded time and public profile status.");
      }
    } catch (error) {
      if (mountedRef.current) {
        setWorkingNowStatusKind("error");
        setWorkingNowStatus(error instanceof Error ? error.message : "Unable to switch to Both.");
      }
    } finally {
      actionPendingRef.current = false;
      if (mountedRef.current) setSwitching(false);
    }
  }

  async function endWorkingNow() {
    if (!activeShift?.id || actionPendingRef.current) return;
    actionPendingRef.current = true;
    setEndConfirmationOpen(false);
    setSaving(true);
    setWorkingNowStatusKind("");
    setWorkingNowStatus("Ending Working Now...");
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    try {
      await requestDancerShiftCheckInJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId: activeShift.id }),
        fallbackMessage: "Unable to end Working Now.",
      });
      if (!mountedRef.current) return;
      setShifts(current => current.map(shift => shift.id === activeShift.id ? { ...shift, checked_out_at: new Date().toISOString() } : shift));
      setWorkingNowStatusKind("success");
      setWorkingNowStatus("Working Now ended. Guests no longer see you in Working Now.");
      try {
        await load();
      } catch {
        if (mountedRef.current) setWorkingNowStatus("Working Now ended. Refresh the dashboard to update your check-in status.");
      }
    } catch (error) {
      if (mountedRef.current) {
        setWorkingNowStatusKind("error");
        setWorkingNowStatus(error instanceof DashboardDataRequestError && error.status === 401
          ? "Sign in again before ending Working Now."
          : error instanceof Error ? error.message : "Unable to end Working Now.");
      }
    } finally {
      actionPendingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <article className="info-panel shift-panel" aria-label="Working Now management">
      <section className={`shift-checkin-card${activeShift ? " ready" : ""}`} aria-live="polite">
        {!hasLoaded ? (
          <span role="status"><strong>{status ? "Check-in unavailable" : "Loading check-in…"}</strong><small>{status ? "Your current status could not be loaded." : "Checking your current club."}</small></span>
        ) : activeShift ? (
          <>
            <span>
              <strong>Working Now at {venueName(activeShift)}</strong>
              <small>
                Active until {formatTime(activeShift.location_verification_expires_at)}.
              </small>
              {isNfcPresenceNearExpiry(activeShift) ? (
                <small className="shift-checkin-status is-error">
                  About {nfcPresenceMinutesRemaining(activeShift)} minutes left. A six-hour cooldown at this club follows. Check out before switching clubs.
                </small>
              ) : null}
            </span>
            {!demoManagedActiveShift ? <div className="shift-ranking-progress">
              <small>External time this shift: <strong>{formatExternalHours(progress?.externalHours)}</strong></small>
              {progress?.visibility === "internal" && hasRecordedExternalTime ? <>
                <p>Choose Both to appear on the club roster and in public MyDancr discovery. This makes your approved profile public.</p>
                <button type="button" disabled={saving || switching} onClick={() => void switchToBoth()}>{switching ? "Switching…" : "Switch to Both"}</button>
              </> : hasRecordedExternalTime && (progress?.visibility === "external" || progress?.visibility === "both")
                ? <small>External time is recording while you work.</small>
                : progress && !hasRecordedExternalTime ? <small>External time is not recorded for this shift. Choose External or Both at your next verified club check-in.</small>
                : <small>Refresh to check your current visibility and recorded time.</small>}
              <a href="#dancer-performance">View activity</a>
            </div> : null}
            {demoManagedActiveShift ? (
              <button className="shift-demo-managed" type="button" disabled>{rhinoShift ? "Automatically managed" : "Demo managed"}</button>
            ) : (
              <button type="button" disabled={saving || switching} onClick={() => {
                setWorkingNowStatus("");
                setWorkingNowStatusKind("");
                setEndConfirmationOpen(true);
              }}>
                {saving ? "Ending..." : "End Working Now"}
              </button>
            )}
            {demoManagedActiveShift ? (
              <small className="shift-checkin-status" role="status">
                {rhinoShift ? "This session stays active automatically." : "This demo session stays active automatically."}
              </small>
            ) : null}
            {endConfirmationOpen ? (
              <div className="shift-end-confirmation" role="alertdialog" aria-labelledby="shift-end-confirmation-heading" aria-describedby="shift-end-confirmation-description">
                <span>
                  <strong id="shift-end-confirmation-heading">End Working Now?</strong>
                  <small id="shift-end-confirmation-description">Guests will stop seeing you in Working Now immediately. This club’s cooldown still applies. You can tap into another approved club.</small>
                </span>
                <div>
                  <button autoFocus className="shift-end-cancel" type="button" disabled={saving} onClick={() => setEndConfirmationOpen(false)}>Keep working</button>
                  <button className="shift-end-confirm" type="button" disabled={saving} onClick={() => void endWorkingNow()}>Yes, end now</button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <span>
              <strong>Not working now</strong>
              <small>Tap the club&apos;s dancer check-in tag to show Working Now.</small>
            </span>
            {cooldownShift ? (
              <small className="shift-checkin-status" role="status">
                This club’s cooldown ends at {formatTime(nfcNextTapAllowedAt(cooldownShift)?.toISOString())}. You can tap into another approved club now.
              </small>
            ) : null}
          </>
        )}
        {workingNowStatus ? (
          <small className={`shift-checkin-status${workingNowStatusKind ? ` is-${workingNowStatusKind}` : ""}`} role="status" aria-live="polite">
            {workingNowStatusKind === "success" ? "✓ " : ""}{workingNowStatus}
          </small>
        ) : null}
      </section>

      <details className="dancer-schedule-help">
        <summary>How check-ins work</summary>
        <ul>
          <li>Unlock your phone and tap the club&apos;s dancer check-in tag. Open the link and sign in if prompted.</li>
          <li>Working Now lasts <strong>6 hours</strong>, followed by a <strong>6-hour cooldown</strong> at that club. Check out before tapping into another approved club. Tapping again won&apos;t extend the current session.</li>
          <li>Your current club appears publicly only while you&apos;re checked in.</li>
        </ul>
      </details>

      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function venueName(shift: ShiftRow) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Club");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "soon";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
