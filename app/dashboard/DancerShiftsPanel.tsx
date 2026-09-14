"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCurrentLocationVerification } from "@/src/lib/dancr/geofence";
import { readSession, requestDancerShiftCheckInJson, requestDancerShiftsJson } from "./dashboard-session";
function DancerShiftPanel() {
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<Record<string, any>>>([]);
  const [venueId, setVenueId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState("");
  const [checkInStatus, setCheckInStatus] = useState("");
  const [checkInTone, setCheckInTone] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState("");
  const [activeCheckInId, setActiveCheckInId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  const loadShifts = useCallback(async () => {
    if (!mountedRef.current) return;
    const requestId = ++loadSequenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const data = await requestDancerShiftsJson({
        cache: "no-store",
        fallbackMessage: "Unable to load posted shifts.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      const approvedVenues = Array.isArray(data.venues) ? data.venues : [];
      setShifts(data.shifts || []);
      setVenues(approvedVenues);
      setVenueId((current) => approvedVenues.some((venue: { id: string }) => venue.id === current)
        ? current
        : String(approvedVenues[0]?.id || ""));
      setEditVenueId((current) => !current || approvedVenues.some((venue: { id: string }) => venue.id === current)
        ? current
        : "");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      throw error;
    } finally {
      if (requestId === loadSequenceRef.current && loadAbortRef.current === controller) loadAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;
    void loadShifts().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load posted shifts.");
    });
  }, [loadShifts]);

  function beginShiftAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentShiftAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishShiftAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function postShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!venueId || !startsAt || !endsAt) {
      setStatus("Choose a venue, start time, and end time.");
      return;
    }

    const action = beginShiftAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSaving(true);
    setStatus("");
    try {
      const data = await requestDancerShiftsJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
        fallbackMessage: "Unable to post shift.",
        signal: controller.signal,
      });
      if (!isCurrentShiftAction(requestId, controller)) return;
      setStatus(`Shift posted. ${data.broadcastRecipients || 0} followers notified.`);
      setCheckInStatus("Shift posted. During the shift, tap the venue's official dressing-room sticker to appear Working Now.");
      setStartsAt("");
      setEndsAt("");
      await loadShifts();
    } catch (error) {
      if (isCurrentShiftAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to post shift.");
    } finally {
      if (finishShiftAction(requestId)) setIsSaving(false);
    }
  }

  function startEditingShift(shift: Record<string, any>) {
    setEditingShiftId(String(shift.id));
    setEditVenueId(String(shift.venue_id || ""));
    setEditStartsAt(toDateTimeLocalValue(shift.starts_at));
    setEditEndsAt(toDateTimeLocalValue(shift.ends_at));
    setStatus("Edit the shift hours, then save. Exact times stay private and are used for check-in and commission eligibility.");
  }

  function stopEditingShift() {
    setEditingShiftId("");
    setEditVenueId("");
    setEditStartsAt("");
    setEditEndsAt("");
  }

  async function saveShiftEdit(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!editVenueId || !editStartsAt || !editEndsAt) {
      setStatus("Choose a venue, start time, and end time before saving.");
      return;
    }

    const action = beginShiftAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSaving(true);
    setStatus("");
    try {
      await requestDancerShiftsJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shiftId,
          venueId: editVenueId,
          startsAt: new Date(editStartsAt).toISOString(),
          endsAt: new Date(editEndsAt).toISOString(),
        }),
        fallbackMessage: "Unable to update shift.",
        signal: controller.signal,
      });
      if (!isCurrentShiftAction(requestId, controller)) return;
      setStatus("Shift updated. During those posted hours, tap the venue's dressing-room sticker to check in.");
      stopEditingShift();
      await loadShifts();
    } catch (error) {
      if (isCurrentShiftAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to update shift.");
    } finally {
      if (finishShiftAction(requestId)) setIsSaving(false);
    }
  }

  async function cancelShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginShiftAction();
    if (!action) return;
    const { requestId, controller } = action;
    setDeletingShiftId(shiftId);
    try {
      const data = await requestDancerShiftsJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId, status: "cancelled" }),
        fallbackMessage: "Unable to cancel shift.",
        signal: controller.signal,
      });
      if (!isCurrentShiftAction(requestId, controller)) return;

      setShifts((current) => current.filter((shift) => String(shift.id) !== shiftId));
      if (editingShiftId === shiftId) stopEditingShift();
      setStatus(`Shift cancelled. ${data.cancellationRecipients || 0} guests notified.`);
    } catch (error) {
      if (isCurrentShiftAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to cancel shift.");
    } finally {
      if (finishShiftAction(requestId)) setDeletingShiftId("");
    }
  }

  async function checkOutShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginShiftAction();
    if (!action) return;
    const { requestId, controller } = action;
    setActiveCheckInId(shiftId);
    setStatus("");
    try {
      await requestDancerShiftCheckInJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId }),
        fallbackMessage: "Unable to check out.",
        signal: controller.signal,
      });
      if (!isCurrentShiftAction(requestId, controller)) return;
      setCheckInStatus("Club check-in ended. Club Deal commission tracking is stopped.");
      setCheckInTone("success");
      setStatus("Checked out. This shift is no longer Working Now.");
      await loadShifts();
    } catch (error) {
      if (isCurrentShiftAction(requestId, controller)) {
        const message = error instanceof Error ? error.message : "Unable to check out.";
        setCheckInStatus(message);
        setCheckInTone("error");
        setStatus(message);
      }
    } finally {
      if (finishShiftAction(requestId)) setActiveCheckInId("");
    }
  }

  const editablePostedShifts = shifts
    .filter((shift) => shift.status === "posted")
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const checkInReadyShifts = editablePostedShifts
    .filter((shift) => shift.status === "posted" && !shift.checked_out_at && new Date(shift.ends_at).getTime() >= Date.now())
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const activeShift =
    checkInReadyShifts.find((shift) => canCheckOutOfShift(shift)) ||
    checkInReadyShifts.find((shift) => canCheckInToShift(shift)) ||
    checkInReadyShifts[0] ||
    null;
  const isCheckedInToActiveShift = activeShift ? canCheckOutOfShift(activeShift) : false;
  const activeLocationIsVerified = activeShift ? isCurrentLocationVerification(activeShift) : false;

  return (
    <article className="info-panel shift-panel">
      <h2>Post Schedule</h2>
      <div className={activeShift ? "shift-checkin-card ready" : "shift-checkin-card"}>
        <span>
          <strong>{activeShift ? (isCheckedInToActiveShift ? (activeLocationIsVerified ? "Club check-in active" : "Club check-in expired") : canCheckInToShift(activeShift) ? "Ready for dressing-room tap" : "Next posted shift") : "No shift ready for check-in"}</strong>
          <small>
            {activeShift
              ? isCheckedInToActiveShift
                ? activeLocationIsVerified
                  ? `${venueName(activeShift)} is live in Now until this club check-in expires or the shift ends.`
                  : `${venueName(activeShift)} is not shown in Working Now. A new dressing-room tap can start one six-hour session only after the cooldown ends.`
                : `${venueName(activeShift)} is posted. During the shift, tap the venue's official dressing-room sticker to check in.`
              : "Post one or more shifts below. Your public cards only show Working Now when checked in, or the nearest upcoming shift when you are not checked in."}
          </small>
        </span>
        {activeShift && !isCheckedInToActiveShift ? <b className="check-in-confirmation">Tap at the club</b> : null}
        {activeShift && isCheckedInToActiveShift ? (
          <button
            type="button"
            className="check-in-confirmation"
            disabled
            aria-label="Check-in confirmed"
            aria-live="polite"
          >
            ✓ Checked in
          </button>
        ) : null}
        {activeShift && canCheckOutOfShift(activeShift) ? (
          <>
            <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkOutShift(String(activeShift.id))}>
              {activeCheckInId === String(activeShift.id) ? "Saving..." : "Check out"}
            </button>
          </>
        ) : null}
        {checkInStatus ? (
          <small
            className={`shift-checkin-status is-${checkInTone}`}
            role={checkInTone === "error" ? "alert" : "status"}
            aria-live={checkInTone === "error" ? "assertive" : "polite"}
          >
            {checkInStatus}
          </small>
        ) : null}
      </div>
      <form onSubmit={postShift}>
        <label>
          Approved venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={!venues.length || isSaving} required>
            <option value="">{venues.length ? "Choose approved venue" : "No tap-approved venues"}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label>
          Ends
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving || !venues.length}>
          {isSaving ? "Posting..." : "Post another shift"}
        </button>
        {!venues.length ? <p>Tap a venue&apos;s official dressing-room sticker to approve it before posting a shift there.</p> : null}
      </form>
      <div className="shift-list-head">
        <strong>Posted shifts</strong>
        <small>All posted shifts live here for editing or deleting. Public cards show only Working Now or the closest upcoming shift.</small>
      </div>
      <div className="shift-list">
        {editablePostedShifts.map((shift) => (
          <div className={deletingShiftId === String(shift.id) ? "dashboard-shift is-deleting" : "dashboard-shift"} key={String(shift.id)}>
            {editingShiftId === String(shift.id) ? (
              <>
                <label>
                  Approved venue
                  <select value={editVenueId} onChange={(event) => setEditVenueId(event.target.value)} required>
                    <option value="">Choose approved venue</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Starts
                  <input type="datetime-local" value={editStartsAt} onChange={(event) => setEditStartsAt(event.target.value)} required />
                </label>
                <label>
                  Ends
                  <input type="datetime-local" value={editEndsAt} onChange={(event) => setEditEndsAt(event.target.value)} required />
                </label>
                <div className="shift-actions">
                  <button type="button" disabled={isSaving} onClick={() => saveShiftEdit(String(shift.id))}>
                    {isSaving ? "Saving..." : "Save shift"}
                  </button>
                  <button type="button" onClick={stopEditingShift}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  <strong>{venueName(shift)}</strong>
                  <small>{formatDashboardShift(shift.starts_at, shift.ends_at)}</small>
                </span>
                <em>{dashboardShiftStatus(shift)}</em>
                <div className="shift-actions">
                  {canCheckInToShift(shift) ? <b className="check-in-confirmation">Tap at dressing room</b> : null}
                  {canCheckOutOfShift(shift) ? (
                    <>
                      <button type="button" className="check-in-confirmation" disabled aria-label="Check-in confirmed">
                        ✓ Checked in
                      </button>
                      <button type="button" disabled={activeCheckInId === String(shift.id)} onClick={() => checkOutShift(String(shift.id))}>
                        {activeCheckInId === String(shift.id) ? "Saving..." : "Check Out"}
                      </button>
                    </>
                  ) : null}
                  {shift.status !== "cancelled" ? (
                    <>
                      <button type="button" disabled={Boolean(deletingShiftId)} onClick={() => startEditingShift(shift)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(deletingShiftId)}
                        aria-busy={deletingShiftId === String(shift.id)}
                        onClick={() => cancelShift(String(shift.id))}
                      >
                        {deletingShiftId === String(shift.id) ? "Deleting..." : "Delete shift"}
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}
        {!editablePostedShifts.length ? <p>No posted shifts yet. Add as many shifts as you need above.</p> : null}
      </div>
      {status ? <p className="shift-panel-feedback" role="status" aria-live="polite">{status}</p> : null}
    </article>
  );
}


function canCheckInToShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || shift.checked_in_at || shift.checked_out_at) return false;
  return isShiftCheckInWindowOpen(shift);
}


function canCheckOutOfShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || !shift.checked_in_at || shift.checked_out_at) return false;
  return new Date(shift.ends_at).getTime() >= Date.now();
}


function isShiftCheckInWindowOpen(shift: Record<string, any>) {
  const startsAt = new Date(shift.starts_at);
  const endsAt = new Date(shift.ends_at);
  const now = new Date();
  return now >= startsAt && now <= endsAt;
}


function dashboardShiftStatus(shift: Record<string, any>) {
  if (shift.status === "cancelled") return "Cancelled";
  if (shift.checked_out_at) return "Checked Out";
  if (isCurrentLocationVerification(shift) && new Date(shift.ends_at).getTime() >= Date.now()) return "Club check-in active";
  if (shift.checked_in_at && !shift.checked_out_at) return "Tap again";
  return "Not checked in";
}


function venueName(shift: Record<string, any>) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}


function formatDashboardShift(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return "Time pending";
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}


function toDateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
