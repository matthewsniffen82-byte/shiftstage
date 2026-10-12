"use client";
import { useEffect, useState } from "react";
import "../updates.css";

type Preference = { channel: "email" | "text"; venueName: string; active: boolean };
export default function UpdatePreferences({ token }: { token: string }) {
  const [preference, setPreference] = useState<Preference | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  async function load(action: "read" | "unsubscribe", signal?: AbortSignal) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/venue-updates", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }), signal: signal || AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load your preferences.");
      if (!signal?.aborted) setPreference(data);
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Unable to load your preferences."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load("read", controller.signal); return () => controller.abort(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return <main className="club-update-page"><section>
    <h1>Club update preferences</h1>
    {busy && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {preference && <><h2>{preference.venueName}</h2><p>{preference.channel === "email" ? "Email" : "Text"} updates are {preference.active ? "turned on" : "stopped"}.</p>
      {preference.active && <button type="button" disabled={busy} onClick={() => void load("unsubscribe")}>Stop {preference.channel} updates</button>}
      <p>Your visit, ride request and other update choices are unchanged.</p></>}
    {error && <button type="button" disabled={busy} onClick={() => void load("read")}>Try again</button>}
  </section></main>;
}
