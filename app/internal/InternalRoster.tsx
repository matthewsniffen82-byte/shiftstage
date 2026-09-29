"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InternalRequestPushSettings } from "./InternalRequestPushSettings";
import { isCurrentBrowserSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";

type Dancer = { id: string; stageName: string; workingUntil: string; avatarRevision: string; mainPhotoId: string | null; mainPhotoRevision: string };
type ClubLink = { id: string; kind: "table"; label: string; token: string };
type ClubRequest = { id: string; link_id: string; dancer_id: string; status: "pending" | "acknowledged"; created_at: string };
type Snapshot = { venueName: string; dancers: Dancer[]; kind?: "table"; label?: string; role?: string; links?: ClubLink[]; requests?: ClubRequest[]; receipt?: { status: string } | null };
type Profile = { id: string; stage_name: string; city: string; venueName: string; workingUntil: string | null; avatarRevision: string; photos: { id: string }[]; videos: { id: string; caption: string | null }[]; socialLinks: { platform: string; handle: string | null; url: string }[] };

async function rosterFetch(url: string, token: string | undefined, body?: Record<string, unknown>, signal?: AbortSignal) {
  const session = token ? null : readBrowserAuthSession();
  if (!token && (!session?.accessToken || session.account?.role !== "venue")) throw new Error("Sign in with your MyDancr club account to open the internal roster.");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
  if (session?.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  let rejectAborted: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  // Bound both the request and response body so a stalled connection cannot stop polling.
  const timer = setTimeout(() => controller.abort(new Error("The request timed out. Please try again.")), 15000);
  const request = async () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetch(url, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers, signal: controller.signal, cache: "no-store", credentials: "same-origin" });
    const data = await response.json().catch(() => null);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (session && !isCurrentBrowserSession(session)) throw new Error("Your account session changed. Refresh this page.");
    if (!response.ok || !data?.ok) throw new Error(data?.error || "The club roster is temporarily unavailable. Please try again.");
    if (session) persistRefreshedBrowserAuthSession(data.session, session);
    return data;
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}

function ProtectedMedia({ id, kind, token, alt, className, revision }: { id: string; kind: "avatar" | "photo" | "video"; token?: string; alt: string; className?: string; revision?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    let objectUrl = "";
    const controller = new AbortController();
    const session = token ? null : readBrowserAuthSession();
    const headers: Record<string, string> = {};
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
    if (session?.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
    void fetch(`/api/internal/${kind}/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { if (controller.signal.aborted || (session && !isCurrentBrowserSession(session))) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!controller.signal.aborted) setUrl(""); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, kind, token, revision]);
  return url ? kind === "video" ? <video src={url} controls playsInline preload="metadata" aria-label={alt} /> : <img className={className} src={url} alt={alt} /> : <span className={className} aria-label="Media loading">…</span>;
}

export function InternalRoster({ token, operationsOnly = false }: { token?: string; operationsOnly?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const selectedProfile = useRef("");
  const requestKey = useRef("");
  const pendingDancer = useRef("");
  const alive = useRef(false);
  const openedRequestInbox = useRef(false);
  const lastGoodRefresh = useRef(Date.now());
  const base = token ? `/api/internal/link/${encodeURIComponent(token)}` : "/api/internal";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await rosterFetch(`${base}${token && requestKey.current ? `?requestKey=${requestKey.current}` : ""}`, token, undefined, signal);
      if (!alive.current || signal?.aborted) return;
      setSnapshot(data); setError("");
      lastGoodRefresh.current = Date.now();
      const selected = selectedProfile.current;
      if (selected) {
        if (!data.dancers.some((dancer: Dancer) => dancer.id === selected)) { selectedProfile.current = ""; setProfile(null); }
        else {
          const result = await rosterFetch(`/api/internal/profile/${selected}${token ? `?token=${encodeURIComponent(token)}` : ""}`, token, undefined, signal);
          if (alive.current && !signal?.aborted && selectedProfile.current === selected) setProfile(result.profile);
        }
      }
    } catch (reason) {
      if (!alive.current || signal?.aborted) return;
      // Privacy first: do not retain a stale roster after a failed authorization or network refresh.
      setSnapshot(null); setProfile(null); selectedProfile.current = ""; setError(reason instanceof Error ? reason.message : "Unable to refresh roster.");
    }
  }, [base, token]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(controller.signal); if (!controller.signal.aborted) timer = setTimeout(poll, 5000); };
    void poll();
    const watchdog = setInterval(() => {
      if (Date.now() - lastGoodRefresh.current > 20000) {
        setSnapshot(null); setProfile(null); selectedProfile.current = "";
        setError(current => current || "The roster could not be refreshed. Retrying automatically.");
      }
    }, 5000);
    const sessionChanged = () => { setSnapshot(null); void refresh(controller.signal); };
    window.addEventListener("storage", sessionChanged);
    return () => { alive.current = false; controller.abort(); clearTimeout(timer); clearInterval(watchdog); window.removeEventListener("storage", sessionChanged); };
  }, [refresh]);

  useEffect(() => {
    if (token || !snapshot) return;
    let frame = 0;
    const openInbox = () => {
      if (openedRequestInbox.current || window.location.hash !== "#table-requests") return;
      frame = window.requestAnimationFrame(() => {
        const inbox = document.getElementById("table-requests");
        if (!inbox) return;
        openedRequestInbox.current = true;
        // The club dashboard nests this inbox inside a collapsed roster section.
        for (let parent = inbox.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        inbox.scrollIntoView({ block: "start" });
        inbox.focus({ preventScroll: true });
      });
    };
    const hashChanged = () => { openedRequestInbox.current = false; openInbox(); };
    openInbox();
    window.addEventListener("hashchange", hashChanged);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", hashChanged); };
  }, [snapshot, token]);

  async function mutate(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      await rosterFetch(base, token, body);
      if (!alive.current) return;
      setNotice(token ? "Request sent to club staff. Staff acknowledgement does not guarantee the dancer is available." : "Saved.");
      setLabel(""); await refresh();
    } catch (reason) { if (alive.current) setNotice(reason instanceof Error ? reason.message : "Unable to save."); }
    finally { if (alive.current) setBusy(false); }
  }

  async function openProfile(dancer: Dancer) {
    selectedProfile.current = dancer.id;
    try {
      const data = await rosterFetch(`/api/internal/profile/${dancer.id}${token ? `?token=${encodeURIComponent(token)}` : ""}`, token);
      if (alive.current && selectedProfile.current === dancer.id) setProfile(data.profile);
    } catch (reason) { if (alive.current) { selectedProfile.current = ""; setProfile(null); setNotice(reason instanceof Error ? reason.message : "Profile unavailable."); } }
  }

  const staff = !token;
  const dancers = snapshot?.dancers || [];
  return <div className={`ir-shell${staff ? " ir-staff" : " ir-guest"}${operationsOnly ? " ir-embedded" : ""}`} data-global-navigation-swipe="ignore">
    {!operationsOnly ? <header className="ir-header"><div><a className="ir-brand" href={staff ? "/dashboard/venue" : "#"}>mydancr{staff ? <span>INTERNAL</span> : null}</a><h1>{snapshot?.venueName || "Club roster"}</h1><p>{staff ? "Your floor. Your team. One live roster." : snapshot?.label || "Welcome to the club"}</p></div>{staff ? <a className="ir-secondary" href="/dashboard/venue">Club dashboard</a> : null}</header> : null}
    {error ? <section className="ir-panel" role="alert"><h2>Roster unavailable</h2><p>{error}</p>{staff ? <a className="ir-button" href="/account?role=venue&mode=login&return_to=%2Finternal">Sign in to MyDancr</a> : null}<button onClick={() => void refresh()}>Try again</button></section> : !snapshot ? <p role="status">Loading the live roster…</p> : null}
    {notice ? <p className="ir-notice" role="status">{notice}</p> : null}
    {snapshot ? <>
      {!operationsOnly ? <section aria-label={staff ? "Live internal roster" : "Available dancers"}><div className="ir-section-title"><h2>On the floor</h2><span className="ir-live">● {snapshot.dancers.length} {staff ? "checked in" : "available"}</span></div>
        {dancers.length ? <div className="ir-grid ir-directory-grid">{dancers.map(dancer => <article className={`ir-dancer${snapshot.kind === "table" ? " ir-dancer-requestable" : ""}`} key={dancer.id}>
          <button type="button" className="ir-profile-link" aria-label={`View ${dancer.stageName}’s full profile`} onClick={() => void openProfile(dancer)}>
            {dancer.mainPhotoId ? <ProtectedMedia key={dancer.mainPhotoId} id={dancer.mainPhotoId} revision={dancer.mainPhotoRevision} kind="photo" token={token} className="ir-main-photo" alt={`${dancer.stageName}’s main photo`} /> : <span className="ir-main-photo ir-photo-placeholder">Photo unavailable</span>}
            <span className="ir-dancer-copy"><strong>{dancer.stageName}</strong><span>View profile ↗</span></span>
          </button>
          {snapshot.kind === "table" ? <button type="button" className="ir-table-request" aria-label={`Request ${dancer.stageName} at our table`} disabled={busy} onClick={() => { if (pendingDancer.current !== dancer.id || ["completed", "cancelled"].includes(snapshot.receipt?.status || "")) { requestKey.current = crypto.randomUUID(); pendingDancer.current = dancer.id; } void mutate({ dancerId: dancer.id, requestKey: requestKey.current }); }}>Request</button> : null}
        </article>)}</div> : <div className="ir-empty"><h3>The floor is getting ready</h3><p>{staff ? "Dancers appear here after choosing Internal or Both at the dressing-room NFC sticker." : "No dancers are available to request right now. Please check back shortly or ask club staff."}</p></div>}
      </section> : null}
      {snapshot.receipt ? <p className="ir-notice" role="status">Your request: <strong>{snapshot.receipt.status === "acknowledged" ? "Seen by club staff" : snapshot.receipt.status}</strong></p> : null}
      {staff ? <div className="ir-operations"><section className="ir-panel" id="table-requests" tabIndex={-1}><h2>Table requests <span>{snapshot.requests?.length || 0}</span></h2><p>“Seen” confirms staff saw the request. Coordinate availability with the dancer.</p>
        <InternalRequestPushSettings />
        {snapshot.requests?.length ? snapshot.requests.map(item => <article className="ir-request" key={item.id}><div><strong>{snapshot.links?.find(link => link.id === item.link_id)?.label || "Table"} → {snapshot.dancers.find(d => d.id === item.dancer_id)?.stageName}</strong><small>{item.status === "pending" ? "New request" : "Seen by staff"} · {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div><div className="ir-actions"><button disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: item.status === "pending" ? "acknowledged" : "completed" })}>{item.status === "pending" ? "Mark seen" : "Complete"}</button><button className="ir-secondary" disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: "cancelled" })}>Dismiss</button></div></article>) : <p className="ir-empty">No open requests.</p>}
      </section><section className="ir-panel"><h2>Table QR codes</h2><p>Create and number your tables, print their QR signs, or revoke a shared link.</p>
        {snapshot.role !== "staff" ? <form className="ir-link-form" onSubmit={event => { event.preventDefault(); void mutate({ action: "link_create", label, kind: "table" }); }}><label>Table number or name<input value={label} maxLength={60} required onChange={event => setLabel(event.target.value)} /></label><button disabled={busy || !label.trim()}>Create link</button></form> : null}
        {snapshot.links?.map(link => <article className="ir-link" key={link.id}><div><strong>{link.label}</strong><small>Table requests</small>{snapshot.role !== "staff" ? <form key={link.label} className="ir-rename-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({ action: "link_update", id: link.id, label: String(form.get("label") || "") }); }}><input name="label" aria-label={`Table number or name for ${link.label}`} defaultValue={link.label} required maxLength={60} /><button disabled={busy}>Save name</button></form> : null}</div><div className="ir-actions"><a href={`/internal/club/${link.token}`} target="_blank" rel="noreferrer">Open</a><a href={`/internal/sign/${link.token}`} target="_blank" rel="noreferrer">Print QR sign</a><button className="ir-secondary" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/internal/club/${link.token}`).then(() => setNotice("Club link copied.")).catch(() => setNotice("Open the link and copy its address."))}>Copy</button>{snapshot.role !== "staff" ? <button className="ir-secondary" disabled={busy} onClick={() => void mutate({ action: "link_revoke", id: link.id })}>Revoke</button> : null}</div></article>)}
      </section></div> : null}
    </> : null}
    <ClubProfileDialog profile={profile} token={token} onClose={() => { selectedProfile.current = ""; setProfile(null); }} />
    {!operationsOnly ? <footer>Powered by MyDancr · {staff ? "Visibility is chosen by each dancer at check-in." : "Availability may change. Club staff coordinate all requests."}</footer> : null}
  </div>;
}

function ClubProfileDialog({ profile, token, onClose }: { profile: Profile | null; token?: string; onClose: () => void }) {
  const profileDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (profile && !profileDialog.current?.open) profileDialog.current?.showModal();
    if (!profile) profileDialog.current?.close();
  }, [profile]);
  return (
<dialog className="ir-profile-dialog" ref={profileDialog} onClose={onClose} aria-label={profile ? `${profile.stage_name}’s full profile` : "Dancer profile"}>
      {profile ? <><button type="button" className="ir-profile-close" aria-label={token ? "Close profile and return to roster" : undefined} autoFocus onClick={onClose}>{token ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg> : "Back to roster ×"}</button><header className="ir-profile-heading"><ProtectedMedia id={profile.id} revision={profile.avatarRevision} kind="avatar" token={token} className="ir-avatar" alt={`${profile.stage_name}’s avatar`} /><div><h2>{profile.stage_name}</h2><p>{profile.city} · <span className={Date.parse(profile.workingUntil || "") > Date.now() ? "ir-live" : ""}>{Date.parse(profile.workingUntil || "") > Date.now() ? "Working now at" : "Affiliated with"} {profile.venueName}</span></p></div></header><nav className="ir-profile-socials" aria-label="Social profiles">{profile.socialLinks.map(link => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer">{link.platform}{link.handle ? ` · ${link.handle}` : ""} ↗</a>)}</nav><div className="ir-profile-photos">{profile.photos.map((photo, index) => <ProtectedMedia key={photo.id} id={photo.id} kind="photo" token={token} alt={`${profile.stage_name} — photo ${index + 1}`} />)}</div>{profile.videos.length ? <section className="ir-profile-videos"><h3>Videos</h3>{profile.videos.map(video => <figure key={video.id}><ProtectedMedia id={video.id} kind="video" token={token} alt={`${profile.stage_name} video`} />{video.caption ? <figcaption>{video.caption}</figcaption> : null}</figure>)}</section> : null}</> : null}
    </dialog>
  );
}

export function VenueRosterProfileButton({ dancerId, stageName }: { dancerId: string; stageName: string }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) { setProfile(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastGood = Date.now();
    const clear = () => { setProfile(null); setOpen(false); };
    const poll = async () => {
      try {
        const data = await rosterFetch('/api/internal/profile/' + dancerId, undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        lastGood = Date.now(); setProfile(data.profile); setError("");
        timer = setTimeout(poll, 5000);
      } catch (reason) {
        if (!controller.signal.aborted) { clear(); setError(reason instanceof Error ? reason.message : "Profile unavailable."); }
      }
    };
    const watchdog = setInterval(() => { if (Date.now() - lastGood > 20000) clear(); }, 5000);
    window.addEventListener("storage", clear);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); clearInterval(watchdog); window.removeEventListener("storage", clear); };
  }, [open, dancerId]);
  return <div className="ir-profile-control ir-staff"><button type="button" onClick={() => setOpen(true)} aria-label={`View ${stageName} profile`}>View profile</button>{error ? <small role="status">{error}</small> : null}<ClubProfileDialog profile={profile} onClose={() => { setOpen(false); setProfile(null); }} /></div>;
}
