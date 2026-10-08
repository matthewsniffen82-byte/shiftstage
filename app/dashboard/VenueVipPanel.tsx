"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";
import type { VenueVipState, VipRequest } from "@/src/lib/dancr/vip-types";
import VipRequests from "../vip/VipRequests";
import "../vip/vip.css";

export default function VenueVipPanel({ refreshKey }: { refreshKey?: string | null }) {
  const [state, setState] = useState<VenueVipState | null>(null);
  const [page, setPage] = useState(0); const [email, setEmail] = useState("");
  const [link, setLink] = useState(""); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [searchInput, setSearchInput] = useState(""); const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(0);
  const [editingMember, setEditingMember] = useState<{ id: string; nickname: string } | null>(null);
  const mounted = useRef(false); const lock = useRef(false); const sequence = useRef(0);
  const load = useCallback(async (nextPage = 0, nextSearch = "", nextMemberPage = 0) => {
    const current = ++sequence.current; const accountId = readSession()?.account?.id;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), memberSearch: nextSearch, memberPage: String(nextMemberPage) });
      const data = await requestDashboardJson(`/api/venue/vip?${params}`, { expectedRole: "venue", cache: "no-store", timeoutMs: 20000 });
      if (mounted.current && sequence.current === current && readSession()?.account?.id === accountId) {
        setState(data); setPage(nextPage); setMemberSearch(nextSearch); setMemberPage(nextMemberPage);
      }
    } catch (failure) { if (mounted.current && sequence.current === current && readSession()?.account?.id === accountId) setError(failure instanceof Error ? failure.message : "Unable to load VIP access."); }
    finally { if (mounted.current && sequence.current === current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  useEffect(() => { if (!lock.current) void load(); }, [load, refreshKey]);

  async function action(body: Record<string, unknown>, success: string) {
    if (lock.current) return false;
    const accountId = readSession()?.account?.id;
    lock.current = true; sequence.current += 1; setBusy(true); setError(""); setStatus("");
    if (body.action === "invite") setLink("");
    try {
      const data = await requestDashboardJson("/api/venue/vip", { expectedRole: "venue", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 30000 });
      if (!mounted.current || readSession()?.account?.id !== accountId) return false;
      if (body.action === "invite") {
        setEmail(""); setLink(data.invitationUrl);
        setStatus(data.emailDelivered ? "Invitation emailed. You can also copy the private link below." : "Invitation created. Email could not be sent; copy and share the private link below.");
      } else { setStatus(success); if (body.action === "revoke_invitation") setLink(""); }
      if (body.action === "set_nickname") {
        setState(current => current ? { ...current, members: current.members.map(member => member.id === body.id ? { ...member, nickname: String(body.nickname).trim() } : member) } : current);
      }
      await load(page, memberSearch, memberPage);
      return true;
    } catch (failure) { if (mounted.current && readSession()?.account?.id === accountId) setError(failure instanceof Error ? failure.message : "Unable to update VIP access."); return false; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function invite(event: FormEvent) { event.preventDefault(); void action({ action: "invite", email }, ""); }
  async function review(request: VipRequest, status: string, note: string) {
    await action({ action: "request_status", id: request.id, expectedStatus: request.status, status, note }, `Request ${status}. The VIP has been notified.`);
  }
  async function saveNickname(event: FormEvent) {
    event.preventDefault();
    if (!editingMember) return;
    if (await action({ action: "set_nickname", id: editingMember.id, nickname: editingMember.nickname }, editingMember.nickname.trim() ? "Nickname saved." : "Nickname removed.")) setEditingMember(null);
  }
  function searchMembers(event: FormEvent) {
    event.preventDefault(); setError(""); setEditingMember(null); void load(page, searchInput.trim(), 0);
  }
  return <div className="venue-vip">
    <div className="vip-row"><div><span className="vip-eyebrow">PRIVATE GUEST ACCESS</span><h2 id="venue-vip-heading">VIP invitations & requests</h2></div><button type="button" disabled={busy || loading} onClick={() => { setError(""); void load(page, memberSearch, memberPage); }}>{loading ? "Refreshing…" : "Refresh VIP"}</button></div>
    <p>Invite a guest privately. They can request a date, time, and dancers from your working or affiliated roster. Your owner and managers receive each request.</p>
    <form className="vip-invite-form" onSubmit={invite}><label>VIP email<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="guest@example.com" disabled={busy} /></label><button type="submit" className="vip-primary" disabled={busy}>{busy ? "Please wait…" : "Send private invitation"}</button></form>
    <small>Links expire after 7 days and can only be accepted by the invited email. Sending a new invitation replaces any unused link for that email.</small>
    {status && <p className="vip-feedback" role="status">{status}</p>}{error && <p className="vip-feedback vip-error" role="alert">{error}</p>}
    {link && <div className="vip-link-result"><label>Private invitation link<input readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setStatus("Private link copied.")).catch(() => setStatus("Select and copy the link above.")); }}>Copy private link</button></div>}
    {!state ? <p role="status">{loading ? "Loading VIP access…" : "Refresh to load VIP access."}</p> : <>
      <details><summary>Pending invitations ({state.invitations.length})</summary><ul className="vip-access-list">{state.invitations.map(invitation => <li key={invitation.id}><span>{invitation.email}<small>Expires {new Date(invitation.expires_at).toLocaleDateString()}</small></span><button type="button" disabled={busy} onClick={() => void action({ action: "revoke_invitation", id: invitation.id }, "Invitation revoked.")}>Revoke invitation</button></li>)}</ul>{!state.invitations.length && <p>No pending invitations.</p>}</details>
      <details><summary>Active VIPs{!memberSearch ? ` (${state.memberCount})` : ""}</summary>
        <form className="vip-member-search" role="search" aria-label="Search VIP accounts" onSubmit={searchMembers}>
          <label>Find a VIP<input type="search" maxLength={80} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Guest name or nickname" disabled={busy} /></label>
          <button type="submit" disabled={busy || loading}>Search</button>
          {(searchInput || memberSearch) && <button type="button" disabled={busy || loading} onClick={() => { setSearchInput(""); setError(""); setEditingMember(null); void load(page, "", 0); }}>Clear search</button>}
        </form>
        <small>Nicknames are only visible to your venue’s team. Leave a nickname blank to remove it.</small>
        {memberSearch && <p className="vip-member-results" role="status">{state.memberCount} {state.memberCount === 1 ? "VIP matches" : "VIPs match"} “{memberSearch}”</p>}
        <ul className="vip-access-list" aria-busy={loading || undefined}>{state.members.map(member => <li key={member.id}>
          <span><strong>{member.nickname || member.display_name}</strong>{member.nickname && <small>{member.display_name}</small>}</span>
          <div className="vip-actions">
            <button type="button" disabled={busy || loading} aria-label={`${member.nickname ? "Edit" : "Add"} nickname for ${member.display_name}`} onClick={() => setEditingMember({ id: member.id, nickname: member.nickname || "" })}>{member.nickname ? "Edit nickname" : "Add nickname"}</button>
            <button type="button" disabled={busy || loading} onClick={() => { if (window.confirm(`Remove VIP access for ${member.nickname || member.display_name}? Existing requests will remain available for review.`)) void action({ action: "revoke_member", id: member.id }, "VIP access removed. Existing requests are still available below."); }}>Remove VIP access</button>
          </div>
          {editingMember?.id === member.id && <form className="vip-nickname-form" onSubmit={saveNickname}>
            <label>Venue nickname for {member.display_name}<input autoFocus type="text" maxLength={80} value={editingMember.nickname} onChange={event => setEditingMember({ id: member.id, nickname: event.target.value })} disabled={busy} /></label>
            <div className="vip-actions"><button type="submit" disabled={busy || loading}>Save nickname</button><button type="button" disabled={busy} onClick={() => setEditingMember(null)}>Cancel</button></div>
          </form>}
        </li>)}</ul>
        {!state.members.length && <p>{memberPage > 0 ? "No VIPs on this page. Return to the previous page." : memberSearch ? "No VIPs match this search." : "Your invited guests will appear here after activating their account."}</p>}
        <div className="vip-actions">
          {memberPage > 0 && <button type="button" disabled={busy || loading} onClick={() => { setEditingMember(null); void load(page, memberSearch, memberPage - 1); }}>Previous VIPs</button>}
          {state.membersHasMore && <button type="button" disabled={busy || loading} onClick={() => { setEditingMember(null); void load(page, memberSearch, memberPage + 1); }}>More VIPs</button>}
        </div>
      </details>
      <div className="vip-row"><h3>Visit requests</h3><button type="button" aria-pressed={pendingOnly} onClick={() => setPendingOnly(value => !value)}>{pendingOnly ? "Show all statuses" : "Show pending on this page"}</button></div>
      <small>Confirm only after checking dancer availability. Dates and times are shown in the venue’s timezone.</small>
      <VipRequests requests={state.requests.filter(request => !pendingOnly || request.status === "pending")} onReview={review} busy={busy} />
      <div className="vip-actions">{page > 0 && <button type="button" disabled={busy || loading} onClick={() => void load(page - 1, memberSearch, memberPage)}>Newer requests</button>}{state.hasMore && <button type="button" disabled={busy || loading} onClick={() => void load(page + 1, memberSearch, memberPage)}>Older requests</button>}</div>
    </>}
  </div>;
}
