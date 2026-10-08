"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/app/components/PasswordField";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { BROWSER_AUTH_SESSION_KEY, captureBrowserAuthSessionGuard, persistBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { readSession, requestDashboardJson, revokeDashboardSession, type StoredDashboardSession } from "@/app/dashboard/dashboard-session";
import { vipLocalDate, type VipInvitation, type VipState } from "@/src/lib/dancr/vip-types";
import VipRequests from "./VipRequests";

export default function VipClient({ token = "" }: { token?: string }) {
  const [session, setSession] = useState<StoredDashboardSession | null>(null);
  const [ready, setReady] = useState(false);
  const [invitation, setInvitation] = useState<VipInvitation | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [state, setState] = useState<VipState | null>(null);
  const [mode, setMode] = useState<"login" | "signup" | "reset_password">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false); const [venueId, setVenueId] = useState(""); const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]); const [search, setSearch] = useState(""); const [workingOnly, setWorkingOnly] = useState(false);
  const [date, setDate] = useState(""); const [time, setTime] = useState(""); const [notes, setNotes] = useState("");
  const pendingRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const lock = useRef(false); const mounted = useRef(false); const loadSequence = useRef(0);
  const customer = session?.account?.role === "customer";
  const venue = state?.venues.find(item => item.id === state.selectedVenueId);

  useEffect(() => {
    mounted.current = true;
    setSession(readSession()); setReady(true);
    const changed = (event: StorageEvent) => {
      if (event.key !== BROWSER_AUTH_SESSION_KEY && event.key !== null) return;
      loadSequence.current += 1;
      setSession(readSession()); setState(null); setSelected([]); setStatus(""); setError("");
    };
    window.addEventListener("storage", changed);
    return () => { mounted.current = false; loadSequence.current += 1; window.removeEventListener("storage", changed); };
  }, []);

  useEffect(() => {
    setInvitation(null); setInviteError("");
    if (!token) return;
    const controller = new AbortController();
    setMode("signup");
    fetch("/api/vip/invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal, cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open invitation."); if (!controller.signal.aborted) setInvitation(data.invitation); })
      .catch(failure => { if (!controller.signal.aborted) setInviteError(failure.message); });
    return () => controller.abort();
  }, [token]);

  const load = useCallback(async (nextVenue = "", nextPage = 0) => {
    const sequence = ++loadSequence.current; const accountId = readSession()?.account?.id;
    setLoading(true);
    try {
      const data = await requestDashboardJson(`/api/vip?venueId=${encodeURIComponent(nextVenue)}&page=${nextPage}`, { expectedRole: "customer", cache: "no-store", timeoutMs: 20000 });
      if (!mounted.current || sequence !== loadSequence.current || readSession()?.account?.id !== accountId) return;
      setState(data); setVenueId(data.selectedVenueId); setPage(nextPage);
      setSelected(previous => previous.filter(id => data.dancers.some((dancer: { id: string }) => dancer.id === id)));
    } catch (failure) { if (mounted.current && sequence === loadSequence.current) setError(message(failure)); }
    finally { if (mounted.current && sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { if (customer && !token) void load(); }, [customer, session?.account?.id, token, load]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const unchanged = captureBrowserAuthSessionGuard();
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("return_to", mode === "reset_password" ? "/account/reset-password" : token ? `/vip/invite/${encodeURIComponent(token)}` : "/vip");
      if (mode === "reset_password") redirect.searchParams.set("type", "recovery");
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ mode, role: "customer", email, password, emailRedirectTo: redirect.toString() }) });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!unchanged()) throw new Error("Your sign-in changed in another window. Refresh to continue.");
      if (!data.session?.accessToken) {
        setStatus(mode === "reset_password" ? data.message : "Check your email to confirm your account. Then return to this private link and sign in to activate VIP access."); setMode("login"); setPassword(""); return;
      }
      if (data.account?.role !== "customer") throw new Error("Use a customer account with the invited email for VIP access.");
      if (!persistBrowserAuthSession({ ...data.session, account: data.account })) throw new Error("Unable to save your sign-in in this browser.");
      setSession(readSession()); setPassword("");
    });
  }
  async function signOut() {
    await run(async () => { await revokeDashboardSession(); if (mounted.current) { setSession(null); setState(null); setSelected([]); } });
  }
  function accept(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      await requestDashboardJson("/api/vip/invitation", { expectedRole: "customer", method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name }), timeoutMs: 20000 });
      if (mounted.current) window.location.assign("/vip");
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!venue) return;
    void run(async () => {
      const input = { venueId: venue.id, localStart: `${date}T${time}`, dancerIds: [...selected].sort(), notes };
      const fingerprint = JSON.stringify(input);
      if (pendingRequest.current?.fingerprint !== fingerprint) pendingRequest.current = { fingerprint, id: crypto.randomUUID() };
      await requestDashboardJson("/api/vip", { expectedRole: "customer", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, requestId: pendingRequest.current.id }), timeoutMs: 30000 });
      if (!mounted.current) return;
      pendingRequest.current = null; setSelected([]); setNotes(""); setDate(""); setTime("");
      setStatus("Request sent. Your venue has been notified and will review your dancers, date, and time.");
      await load(venue.id);
    });
  }
  const visibleDancers = state?.dancers.filter(dancer => (!workingOnly || dancer.working_now) && dancer.stage_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || [];
  return <main className="vip-shell"><div className="vip-container">
    <header className="vip-header"><Link href="/" className="vip-brand">mydanc<span>r</span></Link><div className="vip-actions">{session?.accessToken && <button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button>}<Link href="/dashboard/customer">My account</Link></div></header>
    <div className="vip-hero"><span className="vip-eyebrow">PRIVATE ACCESS · PERSONAL INVITATION</span><h1>Your VIP lounge.</h1><p>{invitation ? `You’re invited to ${invitation.venueName}.` : "Choose your company. Plan your next visit."}</p></div>
    {status && <p className="vip-feedback" role="status">{status}</p>}{error && <p className="vip-feedback vip-error" role="alert">{error}</p>}
    {!ready ? <p role="status">Opening your lounge…</p> : token && !invitation ? <section className="vip-panel"><p role={inviteError ? "alert" : "status"}>{inviteError || "Checking your private invitation…"}</p><Link href="/vip">Go to VIP sign in</Link></section>
    : !session?.accessToken ? <section className="vip-panel vip-auth"><span className="vip-eyebrow">{invitation ? "YOU’RE ON THE LIST" : "WELCOME BACK"}</span><h2>{mode === "signup" ? "Set up your VIP account" : mode === "reset_password" ? "Reset your password" : "VIP sign in"}</h2>
      <p>{invitation ? `Use the invited email (${invitation.maskedEmail}). Already have a MyDancr customer account? Sign in with it.` : "Sign in with your invited customer email. VIP access is provided privately by your venue."}</p>
      {invitation && <div className="vip-actions"><button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => setMode("signup")}>Create account</button><button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => setMode("login")}>Sign in</button></div>}
      <form onSubmit={authenticate}><label>Email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} disabled={busy} /></label>
        {mode !== "reset_password" && <PasswordField label="Password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required disabled={busy} />}
        {mode === "signup" && <PasswordRequirements password={password} />}
        <button className="vip-primary" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset_password" ? "Send reset link" : "Enter VIP lounge"}</button>
      </form><button className="vip-text-button" type="button" disabled={busy} onClick={() => setMode(mode === "reset_password" ? "login" : "reset_password")}>{mode === "reset_password" ? "Back to sign in" : "Forgot password?"}</button>
    </section> : !customer ? <section className="vip-panel"><h2>Use your invited customer account</h2><p>You’re signed in to a different account type. Sign out, then use the email that received your VIP invitation.</p></section>
    : token && invitation ? <section className="vip-panel vip-auth"><span className="vip-eyebrow">{invitation.venueName}</span><h2>Make yourself known.</h2><p>Signed in as {session.account?.email}. This invitation is for {invitation.maskedEmail}.</p><form onSubmit={accept}><label>Your name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" required disabled={busy} /></label><small>Your venue will see this name with your requests.</small><button type="submit" className="vip-primary" disabled={busy}>{busy ? "Activating…" : "Activate VIP access"}</button></form><small>Link expires {new Date(invitation.expiresAt).toLocaleDateString()}.</small></section>
    : !state ? <section className="vip-panel"><p role="status">{loading ? "Loading your private venues…" : "Your lounge couldn’t be loaded."}</p>{!loading && <button type="button" onClick={() => void load()}>Try again</button>}</section>
    : !state.venues.length ? <section className="vip-panel"><h2>Your invitation opens the door.</h2><p>Ask your venue for a private VIP link, then open it to activate your access. Venues you join will appear here.</p></section>
    : <>
      <section className="vip-venue-bar"><div><span className="vip-eyebrow">YOUR PRIVATE VENUE</span><h2>{venue?.name}</h2><p>Welcome, {venue?.guestName}.</p></div><div className="vip-actions">{state.venues.length > 1 && <label>Venue<select value={venueId} disabled={busy || loading} onChange={event => { setState(null); setSelected([]); setDate(""); setTime(""); setNotes(""); setError(""); void load(event.target.value); }}>{state.venues.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<button type="button" disabled={busy || loading} onClick={() => { setError(""); void load(venueId, page); }}>{loading ? "Refreshing…" : "Refresh"}</button></div></section>
      <div className="vip-workspace"><section className="vip-panel"><span className="vip-eyebrow">01 / YOUR GUEST LIST</span><h2>Who would you like to see?</h2><p>Choose up to 10 dancers. Affiliated dancers can be requested even when they aren’t working now.</p>
        <div className="vip-filters"><label>Find a dancer<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stage names" /></label><label className="vip-toggle"><input type="checkbox" checked={workingOnly} onChange={event => setWorkingOnly(event.target.checked)} /> Working now only</label></div>
        <fieldset className="vip-dancers" disabled={busy || loading}><legend className="vip-sr-only">Dancers to request</legend>{visibleDancers.map(dancer => <label className={`vip-dancer ${selected.includes(dancer.id) ? "is-selected" : ""}`} key={dancer.id}><input type="checkbox" checked={selected.includes(dancer.id)} disabled={!selected.includes(dancer.id) && selected.length >= 10} onChange={event => setSelected(previous => event.target.checked ? [...previous, dancer.id] : previous.filter(id => id !== dancer.id))} /><span className="vip-avatar" aria-hidden="true">{dancer.stage_name.slice(0, 2).toUpperCase()}</span><span><strong>{dancer.stage_name}</strong><small className={dancer.working_now ? "vip-working" : ""}>{dancer.working_now ? "● Working now" : "Affiliated · off shift"}</small></span></label>)}</fieldset>
        {!visibleDancers.length && <p className="vip-empty">{state.dancers.length ? "No dancers match this filter." : "No eligible dancers are available to request at this venue yet."}</p>}
      </section><section className="vip-panel vip-visit"><span className="vip-eyebrow">02 / YOUR VISIT</span><h2>Set the date.</h2><p>All times are local to the venue: <strong>{venue?.timezone.replaceAll("_", " ")}</strong>.</p><form onSubmit={submit}>
        <div className="vip-date-grid"><label>Date<input type="date" required min={venue ? vipLocalDate(venue.timezone) : undefined} value={date} onChange={event => setDate(event.target.value)} disabled={busy || loading} /></label><label>Time<input type="time" required value={time} onChange={event => setTime(event.target.value)} disabled={busy || loading} /></label></div>
        <label>Note for the venue (optional)<textarea maxLength={1000} rows={4} placeholder="Anything the venue should know about your visit?" value={notes} onChange={event => setNotes(event.target.value)} disabled={busy || loading} /></label>
        <div className="vip-selection"><strong>{selected.length} / 10 selected</strong><p>{state.dancers.filter(dancer => selected.includes(dancer.id)).map(dancer => dancer.stage_name).join(", ") || "Select dancers from the guest list."}</p></div>
        <button type="submit" className="vip-primary" disabled={busy || loading || !selected.length}>{busy ? "Sending request…" : "Send request to venue"}<span aria-hidden="true"> →</span></button><small>This is a request. The venue will confirm the visit and dancer availability.</small>
      </form></section></div>
      <section className="vip-history"><div className="vip-row"><div><span className="vip-eyebrow">YOUR PLANS</span><h2>Request history</h2></div><span className="vip-badge">{state.requests.filter(request => request.status === "pending").length} pending on this page</span></div><VipRequests requests={state.requests} /><div className="vip-actions">{page > 0 && <button type="button" disabled={busy || loading} onClick={() => void load(venueId, page - 1)}>Newer requests</button>}{state.hasMore && <button type="button" disabled={busy || loading} onClick={() => void load(venueId, page + 1)}>Older requests</button>}</div></section>
    </>}
    <footer className="vip-footer">Private invitations. Personal plans. <span>MyDancr VIP</span></footer>
  </div></main>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
