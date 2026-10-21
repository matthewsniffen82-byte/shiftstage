"use client";
import RefreshButton from "../components/RefreshButton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";
import { CLUB_PRIVACY_CHANGED_EVENT, type CustomerClubPrivacy } from "@/src/lib/dancr/customer-club-privacy";

export default function CustomerClubPrivacyPanel({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false), [clubs, setClubs] = useState<CustomerClubPrivacy[]>([]);
  const [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(false), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [email, setEmail] = useState<string | null>(null), [link, setLink] = useState("");
  const pending = useRef<AbortController | null>(null);
  const current = (request: AbortController) => !request.signal.aborted && pending.current === request && readSession()?.account?.id === accountId;

  async function load(nextPage = 0) {
    if (pending.current || readSession()?.account?.id !== accountId) return;
    const request = new AbortController(); pending.current = request;
    setBusy(true); setError("");
    try {
      const data = await requestDashboardJson(`/api/customer/club-privacy?page=${nextPage}`, {
        expectedRole: "customer", signal: request.signal, timeoutMs: 20_000, cache: "no-store",
      });
      if (!current(request)) return;
      setClubs(existing => nextPage ? [...existing, ...data.clubs.filter((club: CustomerClubPrivacy) => !existing.some(item => item.venue_id === club.venue_id))] : data.clubs);
      setHasMore(data.hasMore); setEmail(data.verifiedEmail); setPage(nextPage); setLoaded(true);
    } catch (reason) { if (current(request)) setError(reason instanceof Error ? reason.message : "Unable to load club privacy."); }
    finally { if (pending.current === request) { pending.current = null; setBusy(false); } }
  }

  useEffect(() => {
    if (open) { setLoaded(false); setClubs([]); setStatus(""); void load(); }
    const refresh = () => { if (open) void load(); };
    window.addEventListener(CLUB_PRIVACY_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      pending.current?.abort(); pending.current = null;
      window.removeEventListener(CLUB_PRIVACY_CHANGED_EVENT, refresh); window.removeEventListener("focus", refresh);
    };
  }, [open, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function change(body: { action: "stop_sharing" | "stop_updates" | "link"; venueId?: string; subscriptionId?: string; link?: string }) {
    if (pending.current || readSession()?.account?.id !== accountId) return;
    const request = new AbortController(); pending.current = request;
    setBusy(true); setError(""); setStatus("");
    let linked = false;
    try {
      await requestDashboardJson("/api/customer/club-privacy", { method: "POST", expectedRole: "customer", timeoutMs: 20_000,
        signal: request.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!current(request)) return;
      if (body.action === "stop_sharing") {
        setClubs(items => items.map(club => club.venue_id === body.venueId ? { ...club, share: null } : club));
        setStatus("Contact sharing stopped. Your email, text and visit choices are unchanged.");
      } else if (body.action === "stop_updates") {
        setClubs(items => items.map(club => ({ ...club, subscriptions: club.subscriptions.map(item => item.id === body.subscriptionId ? { ...item, withdrawnAt: new Date().toISOString() } : item) })));
        setStatus("Updates stopped for this channel. Your other choices are unchanged.");
      } else { setLink(""); setStatus("Update preference added to your account."); linked = true; }
      window.dispatchEvent(new Event(CLUB_PRIVACY_CHANGED_EVENT));
    } catch (reason) { if (current(request)) setError(reason instanceof Error ? reason.message : "Unable to save this choice."); }
    finally { if (pending.current === request) { pending.current = null; setBusy(false); } }
    if (linked && !request.signal.aborted && readSession()?.account?.id === accountId) await load();
  }
  function addLink(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void change({ action: "link", link }); }

  return <details className="customer-account-disclosure customer-club-privacy" id="customer-account-privacy" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Privacy & club updates</summary>
    {open ? <div className="customer-privacy-content">
      <p>Manage shared contact details and updates from each club. Following a club does not subscribe you to emails or texts.</p>
      {busy ? <p role="status">Updating preferences…</p> : null}
      {error ? <div role="alert"><p>{error}</p><RefreshButton label="Reload preferences" busy={busy} type="button" disabled={busy} onClick={() => void load()}>Reload preferences</RefreshButton></div> : null}
      {status ? <p role="status">{status}</p> : null}
      {loaded ? <>
        <p className="customer-privacy-note">{email ? `Includes email updates for ${email} and preferences linked to this account.` : "Verify your account email to see matching email subscriptions. Linked preferences appear below."}</p>
        {clubs.map(club => <section className="customer-privacy-club" key={club.venue_id} aria-labelledby={`privacy-${club.venue_id}`}>
          <h3 id={`privacy-${club.venue_id}`}>{club.venue_name}</h3>
          <div className="customer-privacy-choice"><div><strong>Shared contact details</strong>
            {club.share ? <><p>{club.share.name} · {club.share.email}{club.share.city ? ` · ${club.share.city}` : ""}</p><small>Shared {dateLabel(club.share.consentedAt)}</small></> : <p>Not shared through Following.</p>}</div>
            {club.share ? <button type="button" disabled={busy} onClick={() => void change({ action: "stop_sharing", venueId: club.venue_id })}>Stop sharing</button> : null}
          </div>
          {(["email", "text"] as const).map(channel => {
            const choices = club.subscriptions.filter(item => item.channel === channel);
            return choices.length ? choices.map(item => <div className="customer-privacy-choice" key={item.id}><div>
              <strong>{channel === "email" ? "Email" : "Text"} updates · {item.withdrawnAt ? "Off" : "On"}</strong>
              <p>{item.destination}</p><small>{item.withdrawnAt ? `Stopped ${dateLabel(item.withdrawnAt)}` : `Opted in ${dateLabel(item.consentedAt)}`}</small>
            </div>{!item.withdrawnAt ? <button type="button" disabled={busy} onClick={() => void change({ action: "stop_updates", subscriptionId: item.id })}>Stop {channel} updates</button> : null}</div>)
              : <p className="customer-privacy-note" key={channel}>{channel === "email" ? "Email" : "Text"} updates: no linked preference.</p>;
          })}
        </section>)}
        {!clubs.length ? <p>No shared contact details or linked club updates.</p> : null}
        {hasMore ? <button type="button" disabled={busy} onClick={() => void load(page + 1)}>Show more clubs</button> : null}
      </> : null}
      <details className="customer-add-update-link"><summary>Add a guest update link</summary>
        <p>For texts or another email address, paste the private update link from your guest-list or ride confirmation. Adding it does not subscribe you again.</p>
        <form onSubmit={addLink}><label htmlFor="customer-update-link">Private update link</label>
          <input id="customer-update-link" value={link} onChange={event => setLink(event.target.value)} autoComplete="off" spellCheck={false} maxLength={512} required disabled={busy} />
          <button type="submit" disabled={busy || !link.trim()}>Add to my account</button>
        </form>
      </details>
      <p className="customer-privacy-note">Stopping contact sharing removes your follower details. Visit and ride records remain available to the club for those requests. To opt in to updates again, choose them on a new guest-list or ride request.</p>
    </div> : null}
  </details>;
}

function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
