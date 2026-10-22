"use client";
import { useEffect, useRef, useState } from "react";
import "../../updates/updates.css";

export default function CustomerEmailPreferenceLink({ token }: { token: string }) {
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  async function update(action: "read" | "unsubscribe") {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/customer-email", { method: "POST", cache: "no-store", credentials: "omit", referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.active !== "boolean") throw new Error(data.error || "Your preference could not be confirmed.");
      if (!controller.signal.aborted) setActive(data.active);
    } catch (reason) {
      if (pending.current === controller) setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "The request timed out. Please retry.");
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { setBusy(false); pending.current = null; }
    }
  }
  useEffect(() => {
    setActive(null); void update("read");
    return () => { const controller = pending.current; pending.current = null; controller?.abort(); };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return <main className="club-update-page"><section>
    <h1>MyDancr email preferences</h1>
    <p>No account sign-in is needed.</p>
    {busy && <p role="status">Updating…</p>}
    {error && <p role="alert">{error}</p>}
    {active !== null && <p role="status">Optional MyDancr emails are {active ? "on" : "off"}.</p>}
    {active && <button type="button" disabled={busy} onClick={() => void update("unsubscribe")}>Unsubscribe from MyDancr emails</button>}
    {error && <button type="button" disabled={busy} onClick={() => void update("read")}>Try again</button>}
    <p>Password resets and essential account messages continue. Your club-specific email and text choices, guest-list entries, and ride requests are unchanged.</p>
  </section></main>;
}
