"use client";

export default function VenueUpdateOptIns({ venueName, disabled }: { venueName: string; disabled?: boolean }) {
  return <fieldset className="club-update-opt-ins" disabled={disabled}>
    <legend>Club marketing (optional)</legend>
    <label className="club-transport-consent"><input type="checkbox" name="emailUpdates" /><span>I agree to receive marketing emails from {venueName}, including news, events and offers.</span></label>
    <label className="club-transport-consent"><input type="checkbox" name="textUpdates" /><span>I agree to receive marketing texts from {venueName}, including news, events and offers.</span></label>
    <p className="club-transport-note">Neither is required for entry or a ride. Message frequency varies; message and data rates may apply. Save your confirmation links to stop updates at any time.</p>
  </fieldset>;
}
