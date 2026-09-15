"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BROWSER_AUTH_SESSION_KEY, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { requestDashboardJson, type DashboardJsonRequestOptions } from "../dashboard/dashboard-session";
import type { PickupRole } from "@/src/lib/dancr/pickup-domain";
import { guestPickupKey, PICKUP_GUEST_STORAGE_KEY } from "@/src/lib/dancr/pickup-guest-session";

export function pickupSessionIdentity() {
  const session = readBrowserAuthSession();
  return session?.accessToken ? JSON.stringify([session.account?.role, session.account?.id || session.accessToken]) : "";
}
export async function requestPickupJson(path: string, options: DashboardJsonRequestOptions = {}) {
  const identity = pickupSessionIdentity();
  const id = path.match(/^\/api\/pickups\/([0-9a-f-]{36})(?:\?|$)/i)?.[1];
  const guestKey = options.headers?.["x-pickup-guest-key"] || (id ? guestPickupKey(id) : "");
  if (guestKey) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, options.timeoutMs || 15000);
    try {
      const response = await fetch(path, { method: options.method, body: options.body, cache: "no-store", credentials: "omit",
        headers: { ...options.headers, "x-pickup-guest-key": guestKey }, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || "Unable to open pickup chat."), { status: response.status });
      if (identity !== pickupSessionIdentity() || (id && guestKey !== guestPickupKey(id))) throw new Error("Your pickup session changed. Reopen your private chat link.");
      return result;
    } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
  }
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
    const storage = (event: StorageEvent) => { if (!event.key || event.key === BROWSER_AUTH_SESSION_KEY || event.key === PICKUP_GUEST_STORAGE_KEY) sync(); };
    sync(); window.addEventListener("storage", storage); window.addEventListener("focus", sync);
    const timer = window.setInterval(sync, 1000);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("focus", sync); window.clearInterval(timer); };
  }, []);
  return session;
}
export function PickupAccountGate({ children, customerOnly = false, returnTo, allowGuest = false, requestId }: { children: (role: PickupRole) => ReactNode; customerOnly?: boolean; returnTo?: string; allowGuest?: boolean; requestId?: string }) {
  const session = usePickupAccount();
  const [guestKey, setGuestKey] = useState("");
  useEffect(() => {
    const sync = () => setGuestKey(requestId ? guestPickupKey(requestId) : "");
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("storage", sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); };
  }, [requestId]);
  if (!session.ready) return <p role="status">Checking your account…</p>;
  if (requestId && guestKey) return <div key={`guest:${requestId}:${guestKey}:${session.identity}`}>{children("customer")}</div>;
  if (!session.identity && allowGuest) return <div key="guest">{children("customer")}</div>;
  if (!session.identity && requestId) return <section className="pickup-card"><h1>Open your pickup chat</h1>
    <p>Use the private chat link you saved after requesting pickup, or open a chat saved on this device. No sign-in is needed for guest chats.</p>
    <Link className="pickup-primary" href="/pickups">Saved pickup chats</Link>
    <Link prefetch={false} href={`/?auth=login&role=customer&return_to=${encodeURIComponent(`/pickups/${requestId}`)}`}>I requested pickup with my account</Link>
  </section>;
  if (!session.identity) {
    const destination = encodeURIComponent(returnTo || window.location.pathname + window.location.search);
    return <section className="pickup-card"><h1>Club Pickup</h1><p>Sign in to open your private venue conversations.</p>
      <Link prefetch={false} className="pickup-primary" href={`/?auth=login&role=customer&return_to=${destination}`}>Customer sign in</Link>
      {!customerOnly && <Link prefetch={false} className="pickup-button" href={`/?venueAccess=1&return_to=${destination}`}>Venue sign in</Link>}</section>;
  }
  if (!session.role || !(customerOnly ? ["customer"] : ["customer", "venue", "admin"]).includes(session.role)) return <section className="pickup-card"><h1>Club Pickup</h1><p>This feature is for customers and authorized venue managers. Dancer accounts cannot access pickup conversations.</p><Link href="/">Back to MyDancr</Link></section>;
  return <div key={session.identity}>{children(session.role as PickupRole)}</div>;
}
