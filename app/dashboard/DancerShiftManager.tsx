"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatExternalHours } from "@/src/lib/dancr/external-ranking-progress";
import { DANCER_SCORE_WEIGHTS, EXTERNAL_RANKING_START_MINUTES } from "@/src/lib/dancr/venue-dancer-scores";
import { DancerExternalRankingBenefit } from "./DancerExternalRankingBenefit";
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !actionPendingRef.current) {
        void load().catch(() => { /* Keep the current status until the next refresh. */ });
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeShift = useMemo(
    () => shifts.find((shift) => isActiveNfcPresence(shift)) || null,
    [shifts],
  );
  const demoManagedActiveShift = activeShift?.shift_source === "demo_locked";
  const progress = activeShift?.rankingProgress;
  const hasRecordedExternalTime = typeof progress?.externalHours === "number" && Number.isFinite(progress.externalHours) && progress.externalHours >= 0;
  const presenceKey = activeShift ? `${activeShift.id}:${activeShift.checked_in_at}:${activeShift.location_verification_expires_at}:${progress?.visibility || ""}` : "off";
  useEffect(() => {
    if (hasLoaded) onPresenceChange?.(presenceKey);
  }, [hasLoaded, presenceKey, onPresenceChange]);
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
      setWorkingNowStatus("Both is on. External time is now recording. Ranking benefits start after 5 recorded external minutes. Your shift still ends at the same time.");
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

  const rankingGuidance = <>
    <small><strong>External time helps you rank higher everywhere.</strong></small>
    <small>Time checked in on External or Both carries the most weight in your score—<strong>{DANCER_SCORE_WEIGHTS.externalTime}%</strong>. Higher scores help you appear higher up on the club&apos;s internal roster, public MyDancr listings, and the MyDancrTV feed.</small>
    <small>Benefits start after {EXTERNAL_RANKING_START_MINUTES} recorded minutes. More external time builds your score.</small>
  </>;

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
                  About {nfcPresenceMinutesRemaining(activeShift)} minutes left. A six-hour cooldown begins when this session expires.
                </small>
              ) : null}
            </span>
            {!demoManagedActiveShift ? <div className="shift-ranking-progress">
              {rankingGuidance}
              <small>External time this shift: <strong>{formatExternalHours(progress?.externalHours)}</strong></small>
              {progress?.visibility === "internal" && hasRecordedExternalTime ? <>
                <p>Help guests discover you while you work. Choose Both to keep internal requests and start earning external ranking credit. This makes your approved profile public.</p>
                <button type="button" disabled={saving || switching} onClick={() => void switchToBoth()}>{switching ? "Switching…" : "Switch to Both"}</button>
              </> : hasRecordedExternalTime && (progress?.visibility === "external" || progress?.visibility === "both")
                ? <small>External time is recording while you work.</small>
                : progress && !hasRecordedExternalTime ? <small>External time is not recorded for this shift. Choose External or Both at your next verified club check-in.</small>
                : <small>Refresh to check your current visibility and recorded time.</small>}
              <DancerExternalRankingBenefit refreshKey={presenceKey} />
              <a href="#dancer-performance-ranking">View ranking</a>
            </div> : null}
            {demoManagedActiveShift ? (
              <button className="shift-demo-managed" type="button" disabled>Demo managed</button>
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
                This demo session stays active automatically.
              </small>
            ) : null}
            {endConfirmationOpen ? (
              <div className="shift-end-confirmation" role="alertdialog" aria-labelledby="shift-end-confirmation-heading" aria-describedby="shift-end-confirmation-description">
                <span>
                  <strong id="shift-end-confirmation-heading">End Working Now?</strong>
                  <small id="shift-end-confirmation-description">Guests will stop seeing you in Working Now immediately. Your tap cooldown will still apply.</small>
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
              <small>Tap the club&apos;s dressing-room sticker to show Working Now.</small>
            </span>
            <div className="shift-ranking-progress">{rankingGuidance}</div>
            {cooldownShift ? (
              <small className="shift-checkin-status" role="status">
                Cooldown active. Another tap can start Working Now after {formatTime(nfcNextTapAllowedAt(cooldownShift)?.toISOString())}.
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
          <li>Unlock your phone and tap the club&apos;s dressing-room sticker. Open the link and sign in if prompted.</li>
          <li>Working Now lasts <strong>6 hours</strong>, followed by a <strong>6-hour cooldown</strong> across all clubs. Tapping again won&apos;t extend it.</li>
          <li>Your current club appears publicly only while you&apos;re checked in.</li>
        </ul>
      </details>

      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function venueName(shift: ShiftRow) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "soon";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
