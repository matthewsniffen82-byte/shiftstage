"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BROWSER_AUTH_SESSION_KEY, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { requestDashboardJson, type DashboardJsonRequestOptions } from "../dashboard/dashboard-session";

export function pickupSessionIdentity() {
  const session = readBrowserAuthSession();
  return session?.accessToken ? JSON.stringify([session.account?.role, session.account?.id || session.accessToken]) : "";
}
export async function requestPickupJson(path: string, options: DashboardJsonRequestOptions = {}) {
  const identity = pickupSessionIdentity();
  const result = await requestDashboardJson(path, { cache: "no-store", timeoutMs: 15000, ...options });
  if (!identity || identity !== pickupSessionIdentity()) throw new Error("Your account changed. Sign in again to continue.");
  return result;
}
export function usePickupAccount() {
  const [session, setSession] = useState<{ ready: boolean; identity: string; role?: string }>({ ready: false, identity: "" });
  useEffect(() => {
    const sync = () => {
      const identity = pickupSessionIdentity(), role = readBrowserAuthSession()?.account?.role;
      setSession(current => current.ready && current.identity === identity && current.role === role ? current : { ready: true, identity, role });
    };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === BROWSER_AUTH_SESSION_KEY) sync(); };
    sync(); window.addEventListener("storage", storage); window.addEventListener("focus", sync);
    const timer = window.setInterval(sync, 1000);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("focus", sync); window.clearInterval(timer); };
  }, []);
  return session;
}
export function PickupAccountGate({ children }: { children: (role: "venue" | "admin") => ReactNode }) {
  const session = usePickupAccount();
  if (!session.ready) return <p role="status">Checking your account…</p>;
  if (session.role === "venue" || session.role === "admin") return <div key={session.identity}>{children(session.role)}</div>;
  return <section className="pickup-card"><h1>Club pickup</h1>
    <p>Open a club page to request pickup. The club manager receives your contact details and contacts you directly to confirm your ride.</p>
    <Link className="pickup-primary" href="/?view=venues">Browse clubs</Link>
    {!session.identity && <Link prefetch={false} className="pickup-button" href="/?venueAccess=1&return_to=%2Fpickups">Venue manager sign in</Link>}
  </section>;
}
