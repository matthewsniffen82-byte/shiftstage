"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BROWSER_AUTH_SESSION_KEY, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { requestDashboardJson, type DashboardJsonRequestOptions } from "../dashboard/dashboard-session";
import type { PickupRole } from "@/src/lib/dancr/pickup-domain";

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
export function PickupAccountGate({ children, customerOnly = false }: { children: (role: PickupRole) => ReactNode; customerOnly?: boolean }) {
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
  if (!session.ready) return <p role="status">Checking your account…</p>;
  if (!session.identity) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    return <section className="pickup-card"><h1>Club Pickup</h1><p>Sign in to request pickup or open your private venue conversation.</p>
      <Link className="pickup-primary" href={`/?auth=login&role=customer&return_to=${returnTo}`}>Customer sign in</Link>
      {!customerOnly && <Link className="pickup-button" href={`/?venueAccess=1&return_to=${returnTo}`}>Venue sign in</Link>}</section>;
  }
  if (!session.role || !(customerOnly ? ["customer"] : ["customer", "venue", "admin"]).includes(session.role)) return <section className="pickup-card"><h1>Club Pickup</h1><p>This feature is for customers and authorized venue managers. Dancer accounts cannot access pickup conversations.</p><Link href="/">Back to MyDancr</Link></section>;
  return <div key={session.identity}>{children(session.role as PickupRole)}</div>;
}
