"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  isActiveNfcPresence,
  isNfcPresenceNearExpiry,
  isNfcTapCooldownActive,
  nfcNextTapAllowedAt,
  nfcPresenceMinutesRemaining,
} from "@/src/lib/dancr/shift-presence";

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
  const [editingId, setEditingId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editDate, setEditDate] = useState("");

  const load = useCallback(async () => {
    const session = readDashboardSession();
    if (!session?.accessToken) throw new Error("Sign in required.");
    const response = await fetch("/api/dancer/shifts", {
      cache: "no-store",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load shifts.");
    const nextVenues = Array.isArray(data.venues) ? data.venues : [];
    setVenues(nextVenues);
    setShifts(Array.isArray(data.shifts) ? data.shifts : []);
    setVenueId((current) => nextVenues.some((venue: VenueOption) => venue.id === current)
      ? current
      : String(nextVenues[0]?.id || ""));
  }, []);

  useEffect(() => {
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load shifts."));
  }, [load]);

  const activeShift = useMemo(
    () => shifts.find((shift) => isActiveNfcPresence(shift)) || null,
    [shifts],
  );
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
    await saveRequest("/api/dancer/shifts", "POST", { venueId, shiftDate }, "Upcoming date posted.");
    setShiftDate("");
  }

  async function saveEdit(shiftId: string) {
    if (!editVenueId || !editDate) {
      setStatus("Choose a venue and date before saving.");
      return;
    }
    await saveRequest("/api/dancer/shifts", "PATCH", { shiftId, venueId: editVenueId, shiftDate: editDate }, "Upcoming date updated.");
    setEditingId("");
  }

  async function cancelDate(shiftId: string) {
    await saveRequest("/api/dancer/shifts", "PATCH", { shiftId, status: "cancelled" }, "Upcoming date cancelled.");
  }

  async function endWorkingNow() {
    if (!activeShift?.id) return;
    await saveRequest("/api/dancer/shifts/check-in", "DELETE", { shiftId: activeShift.id }, "Working Now ended.");
  }

  async function saveRequest(url: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, success: string) {
    const session = readDashboardSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save changes.");
      setStatus(success);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setSaving(false);
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
            <button type="button" disabled={saving} onClick={() => void endWorkingNow()}>
              {saving ? "Ending..." : "End Working Now"}
            </button>
          </>
        ) : (
          <>
            <span>
              <strong>Not working now</strong>
              <small>A posted upcoming date does not make you live. Only the venue&apos;s dressing-room NFC tag can put you in Now.</small>
            </span>
            <button type="button" className="check-in-confirmation" disabled={Boolean(cooldownShift)} onClick={() => setTapReady(true)}>
              Tap dressing-room NFC to go Working Now
            </button>
            {cooldownShift ? (
              <small className="shift-checkin-status" role="status">
                Cooldown active. Another tap can start Working Now after {formatTime(nfcNextTapAllowedAt(cooldownShift)?.toISOString())}.
              </small>
            ) : null}
            {tapReady ? (
              <small className="shift-checkin-status is-loading" role="status">
                Ready to tap: hold your phone near the dressing-room NFC tag. The secure venue page starts one six-hour Working Now session followed by a six-hour cooldown.
              </small>
            ) : null}
          </>
        )}
      </section>

      <form onSubmit={postDate}>
        <label>
          Approved venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} disabled={!venues.length || saving} required>
            <option value="">{venues.length ? "Choose approved venue" : "No approved venue affiliations"}</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </label>
        <label>
          Upcoming date
          <input type="date" min={todayDate()} value={shiftDate} onChange={(event) => setShiftDate(event.target.value)} required />
        </label>
        <button type="submit" disabled={saving || !venues.length}>{saving ? "Posting..." : "Post upcoming date"}</button>
        <p>Schedules show only the venue and date. No shift time or phone location is collected.</p>
        {!venues.length ? <p>Tap a venue&apos;s dressing-room NFC tag once to create an approved affiliation.</p> : null}
        {status ? <p role="status">{status}</p> : null}
      </form>

      <div className="shift-list-head">
        <strong>Upcoming dates</strong>
        <small>These tell customers where you plan to be. Tap the dressing-room NFC tag when you arrive to appear in Now.</small>
      </div>
      <div className="shift-list">
        {postedDates.map((shift) => (
          <div className="dashboard-shift" key={String(shift.id)}>
            {editingId === String(shift.id) ? (
              <>
                <label>
                  Approved venue
                  <select value={editVenueId} onChange={(event) => setEditVenueId(event.target.value)} required>
                    {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                  </select>
                </label>
                <label>
                  Upcoming date
                  <input type="date" min={todayDate()} value={editDate} onChange={(event) => setEditDate(event.target.value)} required />
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

function readDashboardSession(): { accessToken?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem("dancrAuthSessionV1") || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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
