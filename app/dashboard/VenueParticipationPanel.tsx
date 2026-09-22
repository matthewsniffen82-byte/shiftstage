"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";

export default function VenueParticipationPanel({ venueId, venueName, onEnded }: {
  venueId: string; venueName: string; onEnded: () => void;
}) {
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setEndedAt(null); setConfirming(false);
    void requestDashboardJson(`/api/venue/participation?venueId=${encodeURIComponent(venueId)}`, { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) { setEndedAt(data.endedAt); setLoaded(true); } })
      .catch(() => { if (!controller.signal.aborted) setStatus("Unable to check club participation. Refresh to try again."); });
    return () => controller.abort();
  }, [venueId]);

  async function remove() {
    if (pending.current || !loaded) return;
    pending.current = true; setBusy(true); setStatus("");
    try {
      const data = await requestDashboardJson("/api/venue/participation", {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId, confirmed: true }),
      });
      if (data.venueId !== venueId || !data.endedAt || data.dancerAccountsPreserved !== true) throw new Error("Refresh to confirm club removal.");
      setEndedAt(data.endedAt); setConfirming(false); onEnded();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to remove the club."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <article className="info-panel">
    <h3>Club participation</h3>
    {endedAt ? <p role="status">Your club listing, dancer affiliations, and check-ins have been removed. Dancers keep their accounts and media. Contact MyDancr to arrange a new agreement before returning.</p> : <>
      <p>Remove {venueName} from MyDancr and end its dancer affiliations and check-ins. Dancer accounts, profiles, photos, and videos stay intact.</p>
      {confirming ? <div role="alertdialog" aria-label={`Remove ${venueName} from MyDancr?`}>
        <p>The club’s tap stickers will stop working. Returning requires a new agreement with MyDancr.</p>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep club on MyDancr</button>{" "}
        <button type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Removing…" : "Confirm club removal"}</button>
      </div> : <button type="button" disabled={!loaded || busy} onClick={() => setConfirming(true)}>Remove club from MyDancr</button>}
    </>}
    {status ? <p role="status">{status}</p> : null}
  </article>;
}
