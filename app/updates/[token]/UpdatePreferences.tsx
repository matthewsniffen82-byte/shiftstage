"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { readSession, requestDashboardJson } from "@/app/dashboard/dashboard-session";
import "../updates.css";

type Preference = { channel: "email" | "text"; venueName: string; active: boolean };
export default function UpdatePreferences({ token }: { token: string }) {
  const [preference, setPreference] = useState<Preference | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [accountId, setAccountId] = useState(""), [linked, setLinked] = useState(false);
  useEffect(() => { const account = readSession()?.account; setAccountId(account?.role === "customer" ? String(account.id || "") : ""); }, []);
  async function saveToAccount() {
    if (busy || !accountId || readSession()?.account?.id !== accountId) return;
    setBusy(true); setError("");
    try {
      await requestDashboardJson("/api/customer/club-privacy", { method: "POST", expectedRole: "customer", timeoutMs: 20_000,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "link", link: token }) });
      if (readSession()?.account?.id === accountId) setLinked(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this preference."); }
    finally { setBusy(false); }
  }
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
    {preference && accountId ? <div>{linked ? <p role="status">Saved to your account.</p> : <button type="button" disabled={busy} onClick={() => void saveToAccount()}>Save preference to my account</button>}
      <p><Link href="/dashboard/customer#customer-account-privacy">Privacy & club updates</Link></p></div> : null}
    {error && <button type="button" disabled={busy} onClick={() => void load("read")}>Try again</button>}
  </section></main>;
}
