"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
} from "./dashboard-session";

type VenueOption = { id: string; name: string; timezone?: string };
type ShiftRow = Record<string, any>;

export default function DancerShiftManager() {
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [venueId, setVenueId] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [status, setStatus] = useState("");
  const [tapReady, setTapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [workingNowStatus, setWorkingNowStatus] = useState("");
  const [workingNowStatusKind, setWorkingNowStatusKind] = useState<"" | "error" | "success">("");
  const [editingId, setEditingId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editDate, setEditDate] = useState("");
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

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
      const nextVenues = Array.isArray(data.venues) ? data.venues : [];
      setVenues(nextVenues);
      setShifts(Array.isArray(data.shifts) ? data.shifts : []);
      setVenueId((current) => nextVenues.some((venue: VenueOption) => venue.id === current)
        ? current
        : String(nextVenues[0]?.id || ""));
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

  const activeShift = useMemo(
    () => shifts.find((shift) => isActiveNfcPresence(shift)) || null,
    [shifts],
  );
  const demoManagedActiveShift = activeShift?.shift_source === "demo_locked";
  const latestNfcShift = useMemo(
    () => shifts
      .filter((shift) => Boolean(shift.nfc_last_tapped_at || shift.nfcLastTappedAt))
      .sort((left, right) => Date.parse(String(right.nfc_last_tapped_at || right.nfcLastTappedAt || 0))
        - Date.parse(String(left.nfc_last_tapped_at || left.nfcLastTappedAt || 0)))[0] || null,
    [shifts],
  );
  const cooldownShift = latestNfcShift && isNfcTapCooldownActive(latestNfcShift) ? latestNfcShift : null;
  const postedDates = useMemo(
    () => shifts
      .filter((shift) => shift.shift_source !== "nfc_presence" && ["posted", "cancelled"].includes(String(shift.status)))
      .sort((left, right) => String(right.shift_date || "").localeCompare(String(left.shift_date || ""))),
    [shifts],
  );

  async function postDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venueId || !shiftDate) {
      setStatus("Choose a venue and date.");
      return;
    }
    await saveRequest("POST", { venueId, shiftDate }, "Upcoming date posted.");
    if (mountedRef.current) setShiftDate("");
  }

  async function saveEdit(shiftId: string) {
    if (!editVenueId || !editDate) {
      setStatus("Choose a venue and date before saving.");
      return;
    }
    await saveRequest("PATCH", { shiftId, venueId: editVenueId, shiftDate: editDate }, "Upcoming date updated.");
    if (mountedRef.current) setEditingId("");
  }

  async function cancelDate(shiftId: string) {
    await saveRequest("PATCH", { shiftId, status: "cancelled" }, "Upcoming date cancelled.");
  }

  async function endWorkingNow() {
    if (!activeShift?.id) return;
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
      setWorkingNowStatusKind("success");
      setWorkingNowStatus("Working Now ended. Guests no longer see you in Working Now.");
      try {
        await load();
      } catch {
        if (mountedRef.current) setWorkingNowStatus("Working Now ended. Refresh the dashboard to update the schedule card.");
      }
    } catch (error) {
      if (mountedRef.current) {
        setWorkingNowStatusKind("error");
        setWorkingNowStatus(error instanceof DashboardDataRequestError && error.status === 401
          ? "Sign in again before ending Working Now."
          : error instanceof Error ? error.message : "Unable to end Working Now.");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function saveRequest(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, success: string) {
    setSaving(true);
    setStatus("");
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    try {
      await requestDancerShiftsJson({
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        fallbackMessage: "Unable to save changes.",
      });
      if (!mountedRef.current) return;
      setStatus(success);
      await load();
    } catch (error) {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <article className="info-panel shift-panel">
      <h2>Shift Manager</h2>
      <section className={`shift-checkin-card${activeShift ? " ready" : ""}`} aria-live="polite">
        {activeShift ? (
          <>
            <span>
              <strong>Working Now at {venueName(activeShift)}</strong>
              <small>
                Active until {formatTime(activeShift.location_verification_expires_at)}. Retaps cannot extend this six-hour session.
              </small>
              {isNfcPresenceNearExpiry(activeShift) ? (
                <small className="shift-checkin-status is-error">
                  About {nfcPresenceMinutesRemaining(activeShift)} minutes left. A six-hour cooldown begins when this session expires.
                </small>
              ) : null}
            </span>
            {demoManagedActiveShift ? (
              <button className="shift-demo-managed" type="button" disabled>Demo managed</button>
            ) : (
              <button type="button" disabled={saving} onClick={() => {
                setWorkingNowStatus("");
                setWorkingNowStatusKind("");
                setEndConfirmationOpen(true);
              }}>
                {saving ? "Ending..." : "End Working Now"}
              </button>
            )}
            {demoManagedActiveShift ? (
              <small className="shift-checkin-status" role="status">
                This fictional Demo Mode assignment is kept active automatically and cannot be ended from the dancer dashboard.
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
              <small>A posted upcoming date does not make you live. Tap the venue&apos;s dressing-room sticker when you arrive.</small>
            </span>
            <button type="button" className="check-in-confirmation" disabled={Boolean(cooldownShift)} onClick={() => setTapReady(true)}>
              Tap at dressing room to go Working Now
            </button>
            {cooldownShift ? (
              <small className="shift-checkin-status" role="status">
                Cooldown active. Another tap can start Working Now after {formatTime(nfcNextTapAllowedAt(cooldownShift)?.toISOString())}.
              </small>
            ) : null}
            {tapReady ? (
              <small className="shift-checkin-status is-loading" role="status">
                Ready to tap: hold your phone near the dressing-room sticker. The secure venue page starts one six-hour Working Now session followed by a six-hour cooldown.
              </small>
            ) : null}
          </>
        )}
        {workingNowStatus ? (
          <small className={`shift-checkin-status${workingNowStatusKind ? ` is-${workingNowStatusKind}` : ""}`} role="status" aria-live="polite">
            {workingNowStatusKind === "success" ? "✓ " : workingNowStatusKind === "error" ? "Unable to end: " : ""}{workingNowStatus}
          </small>
        ) : null}
      </section>

      <form onSubmit={postDate}>
        <label>
          Approved venue
          <select className="dancer-schedule-control" value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={!venues.length || saving} required>
            <option value="">{venues.length ? "Choose approved venue" : "No approved venue affiliations"}</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </label>
        <label>
          Upcoming date
          <input className="dancer-schedule-control" type="date" min={todayDate()} value={shiftDate} onChange={(event) => setShiftDate(event.target.value)} required />
        </label>
        <button type="submit" disabled={saving || !venues.length}>{saving ? "Posting..." : "Post upcoming date"}</button>
        <p>Schedules show only the venue and date. No shift time or phone location is collected.</p>
        {!venues.length ? <p>Tap a venue&apos;s dressing-room sticker once to approve that club.</p> : null}
        {status ? <p role="status">{status}</p> : null}
      </form>

      <div className="shift-list-head">
        <strong>Upcoming dates</strong>
        <small>These tell guests where you plan to be. Tap the dressing-room sticker when you arrive to appear in Now.</small>
      </div>
      <div className="shift-list">
        {postedDates.map((shift) => (
          <div className="dashboard-shift" key={String(shift.id)}>
            {editingId === String(shift.id) ? (
              <>
                <label>
                  Approved venue
                  <select className="dancer-schedule-control" value={editVenueId} onChange={(event) => setEditVenueId(event.target.value)} required>
                    {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                  </select>
                </label>
                <label>
                  Upcoming date
                  <input className="dancer-schedule-control" type="date" min={todayDate()} value={editDate} onChange={(event) => setEditDate(event.target.value)} required />
                </label>
                <div className="shift-actions">
                  <button type="button" disabled={saving} onClick={() => void saveEdit(String(shift.id))}>{saving ? "Saving..." : "Save date"}</button>
                  <button type="button" onClick={() => setEditingId("")}>Done</button>
                </div>
              </>
            ) : (
              <>
                <span><strong>{venueName(shift)}</strong><small>{formatShiftDate(shift.shift_date || shift.starts_at)}</small></span>
                <em>{shift.status === "cancelled" ? "Cancelled" : "Upcoming"}</em>
                {shift.status !== "cancelled" ? (
                  <div className="shift-actions">
                    <button type="button" onClick={() => {
                      setEditingId(String(shift.id));
                      setEditVenueId(String(shift.venue_id || ""));
                      setEditDate(String(shift.shift_date || ""));
                    }}>Edit</button>
                    <button type="button" onClick={() => void cancelDate(String(shift.id))}>Delete date</button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
        {!postedDates.length ? <p>No upcoming dates posted.</p> : null}
      </div>
    </article>
  );
}

function venueName(shift: ShiftRow) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatShiftDate(value: string) {
  if (!value) return "Date pending";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value: string | null | undefined) {
  if (!value) return "soon";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
