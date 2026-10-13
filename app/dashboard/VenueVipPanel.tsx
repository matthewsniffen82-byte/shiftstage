"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";
import type { VenueVipState, VipRequest } from "@/src/lib/dancr/vip-types";
import { notifyVenueOperationsChanged } from "@/src/lib/dancr/venue-operations";
import VipRequests from "../vip/VipRequests";
import "../vip/vip.css";
import "./venue-vip.css";

const sections = [["requests", "Requests"], ["members", "VIP guests"], ["invitations", "Invitations"]] as const;
type VipSection = typeof sections[number][0];

export default function VenueVipPanel({ refreshKey, active = true }: { refreshKey?: string | null; active?: boolean }) {
  const [state, setState] = useState<VenueVipState | null>(null);
  const [section, setSection] = useState<VipSection>("requests");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [memberTotal, setMemberTotal] = useState<number | null>(null);
  const inviteEmail = useRef<HTMLInputElement>(null);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const focusInvite = useRef(false);
  const [page, setPage] = useState(0); const [email, setEmail] = useState("");
  const [inviteNickname, setInviteNickname] = useState("");
  const [invitationSent, setInvitationSent] = useState(false);
  const [link, setLink] = useState(""); const [linkId, setLinkId] = useState(""); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [searchInput, setSearchInput] = useState(""); const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(0);
  const [editingMember, setEditingMember] = useState<{ id: string; nickname: string } | null>(null);
  const mounted = useRef(false); const lock = useRef(false); const sequence = useRef(0);
  const view = useRef({ page: 0, search: "", memberPage: 0, pendingOnly: true });
  const load = useCallback(async (nextPage = 0, nextSearch = "", nextMemberPage = 0, nextPendingOnly = false) => {
    const current = ++sequence.current; const accountId = readSession()?.account?.id;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), memberSearch: nextSearch, memberPage: String(nextMemberPage), status: nextPendingOnly ? "pending" : "all" });
      const data = await requestDashboardJson(`/api/venue/vip?${params}`, { expectedRole: "venue", cache: "no-store", timeoutMs: 20000 });
      if (mounted.current && sequence.current === current && readSession()?.account?.id === accountId) {
        view.current = { page: nextPage, search: nextSearch, memberPage: nextMemberPage, pendingOnly: nextPendingOnly };
        setState(data); setPage(nextPage); setMemberSearch(nextSearch); setMemberPage(nextMemberPage); setPendingOnly(nextPendingOnly);
        if (!nextSearch) setMemberTotal(data.memberCount);
      }
    } catch (failure) { if (mounted.current && sequence.current === current && readSession()?.account?.id === accountId) setError(failure instanceof Error ? failure.message : "Unable to load VIP access."); }
    finally { if (mounted.current && sequence.current === current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  useEffect(() => {
    if (active && !lock.current) void load(view.current.page, view.current.search, view.current.memberPage, view.current.pendingOnly);
  }, [load, refreshKey, active]);
  useEffect(() => {
    if (section === "invitations" && inviteOpen && focusInvite.current) { focusInvite.current = false; inviteEmail.current?.focus(); }
  }, [section, inviteOpen]);

  async function action(body: Record<string, unknown>, success: string) {
    if (lock.current) return false;
    const accountId = readSession()?.account?.id;
    lock.current = true; sequence.current += 1; setBusy(true); setError(""); setStatus("");
    const invitationAction = ["invite", "resend_invitation", "share_invitation"].includes(String(body.action));
    if (invitationAction) { setLink(""); setLinkId(""); }
    try {
      const data = await requestDashboardJson("/api/venue/vip", { expectedRole: "venue", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 30000 });
      if (!mounted.current || readSession()?.account?.id !== accountId) return false;
      if (invitationAction) {
        if (body.action === "invite") { setEmail(""); setInviteNickname(""); setInvitationSent(data.emailDelivered === true); }
        setLink(data.invitationUrl); setLinkId(data.invitationId || "");
        setStatus(body.action === "share_invitation" ? "New private link ready to share. The previous link has been replaced." : data.emailDelivered ? "Invitation sent. You can also copy the private link below." : "Invitation created. Email could not be sent; copy and share the private link below.");
      } else { setStatus(success); if (body.action === "revoke_invitation") setLink(""); }
      if (body.action === "set_nickname") {
        setState(current => current ? { ...current, members: current.members.map(member => member.id === body.id ? { ...member, nickname: String(body.nickname).trim() } : member) } : current);
      }
      if (body.action === "revoke_member") setMemberTotal(current => current == null ? current : Math.max(0, current - 1));
      notifyVenueOperationsChanged();
      await load(page, memberSearch, memberPage, pendingOnly);
      return true;
    } catch (failure) { if (mounted.current && readSession()?.account?.id === accountId) setError(failure instanceof Error ? failure.message : "Unable to update VIP access."); return false; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function shareLink() {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: "Your MyDancr VIP invitation", url: link });
      else { await navigator.clipboard.writeText(link); setStatus("Private link copied."); }
    } catch (failure) { if (!(failure instanceof Error && failure.name === "AbortError")) setStatus("Select and copy the private link above."); }
  }
  function invite(event: FormEvent) { event.preventDefault(); if (!invitationSent) void action({ action: "invite", email, nickname: inviteNickname }, ""); }
  async function review(request: VipRequest, status: string, note: string) {
    await action({ action: "request_status", id: request.id, expectedStatus: request.status, expectedUpdatedAt: request.updated_at || request.created_at, status, note }, `Request ${status}. The VIP has been notified.`);
  }
  async function saveNickname(event: FormEvent) {
    event.preventDefault();
    if (!editingMember) return;
    if (await action({ action: "set_nickname", id: editingMember.id, nickname: editingMember.nickname }, editingMember.nickname.trim() ? "Nickname saved." : "Nickname removed.")) setEditingMember(null);
  }
  function searchMembers(event: FormEvent) {
    event.preventDefault(); setError(""); setEditingMember(null); void load(page, searchInput.trim(), 0, pendingOnly);
  }
  function openInvitation() {
    if (section === "invitations" && inviteOpen) inviteEmail.current?.focus();
    else focusInvite.current = true;
    setSection("invitations"); setInviteOpen(true); setInvitationSent(false);
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: VipSection) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = sections.findIndex(([id]) => id === current);
    const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length;
    const id = sections[next][0]; setSection(id);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#venue-vip-tab-${id}`)?.focus();
  }
  const counts = { requests: state?.requestCount, members: memberTotal, invitations: state?.invitations.length };
  return <div className="venue-vip">
    <div className="vip-row venue-vip-header"><h2 id="venue-vip-heading">VIP access</h2><div className="vip-actions">
      <button type="button" className="venue-vip-refresh" aria-label="Refresh VIP access" disabled={busy || loading} onClick={() => { setError(""); void load(page, memberSearch, memberPage, pendingOnly); }}>{loading ? "Refreshing…" : "Refresh"}</button>
      <button ref={inviteButton} type="button" className="vip-primary" aria-expanded={section === "invitations" && inviteOpen} aria-controls="venue-vip-invite-form" disabled={busy} onClick={openInvitation}>Invite guest</button>
    </div></div>
    <div className="venue-vip-tabs" role="tablist" aria-label="VIP access">
      {sections.map(([id, label]) => <button key={id} type="button" role="tab" id={`venue-vip-tab-${id}`} aria-controls={`venue-vip-panel-${id}`} aria-selected={section === id} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)} onKeyDown={event => moveTab(event, id)}>
        {label}{counts[id] != null && <span className="venue-vip-count" aria-label={`${counts[id]} ${id === "requests" && pendingOnly ? "pending requests" : label.toLowerCase()}`}>{counts[id]}</span>}
      </button>)}
    </div>
    {status && <p className="vip-feedback" role="status">{status}</p>}{error && <p className="vip-feedback vip-error" role="alert">{error}</p>}
    {!state && <p role="status">{loading ? "Loading VIP access…" : "Refresh to load VIP access."}</p>}
    <section className="venue-vip-tab-panel venue-vip-requests" id="venue-vip-panel-requests" role="tabpanel" aria-labelledby="venue-vip-tab-requests" hidden={section !== "requests"} tabIndex={0}>
    {state && <>
      <div className="venue-vip-request-filters" role="group" aria-label="Filter visit requests">
        <button type="button" disabled={busy || loading} aria-pressed={pendingOnly} onClick={() => { setError(""); void load(0, memberSearch, memberPage, true); }}>Pending requests</button>
        <button type="button" disabled={busy || loading} aria-pressed={!pendingOnly} onClick={() => { setError(""); void load(0, memberSearch, memberPage, false); }}>All statuses</button>
      </div>
      <VipRequests requests={state.requests} onReview={review} busy={busy || loading} emptyMessage={page > 0 ? "No requests on this page. Return to newer requests." : pendingOnly ? "No pending requests. Check All statuses for previous visits." : "No visit requests yet."} />
      <div className="vip-actions">{page > 0 && <button type="button" disabled={busy || loading} onClick={() => void load(page - 1, memberSearch, memberPage, pendingOnly)}>Newer requests</button>}{state.hasMore && <button type="button" disabled={busy || loading} onClick={() => void load(page + 1, memberSearch, memberPage, pendingOnly)}>Older requests</button>}</div>
    </>}
    </section>
    <section className="venue-vip-tab-panel" id="venue-vip-panel-invitations" role="tabpanel" aria-labelledby="venue-vip-tab-invitations" hidden={section !== "invitations"} tabIndex={0}>
    <div className="venue-vip-invite" id="venue-vip-invite-form" hidden={!inviteOpen}>
      <div className="vip-row"><h3>Invite a guest</h3><button type="button" aria-label="Close invitation form" disabled={busy} onClick={() => { setInviteOpen(false); inviteButton.current?.focus(); }}>Close</button></div>
      <p>Invite guests to request visits and dancers.</p>
      <form className="vip-invite-form" onSubmit={invite}>
        <label>Guest email<input ref={inviteEmail} type="email" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setInvitationSent(false); }} placeholder="guest@example.com" disabled={busy} /></label>
        <label>Private nickname (optional)<input type="text" maxLength={80} value={inviteNickname} onChange={event => { setInviteNickname(event.target.value); setInvitationSent(false); }} placeholder="How you know this guest" disabled={busy} /></label>
        <button type="submit" className="vip-primary" disabled={busy || invitationSent}>{busy ? "Please wait…" : invitationSent ? "Invitation sent" : "Send invitation"}</button>
      </form>
      <small>Invitation valid for 7 days. Nicknames are private to your venue&apos;s owners and managers.</small>
      <details><summary>How invitations work</summary><small>Only the invited email can use the link. Reinviting replaces that email’s unused link. Resend email and New share link also replace the previous link. Owners and managers review each visit request.</small></details>
    </div>

    {link && <div className="vip-link-result"><label>Private invitation link<input readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setStatus("Private link copied.")).catch(() => setStatus("Select and copy the link above.")); }}>Copy private link</button><button type="button" onClick={() => void shareLink()}>Share invitation</button></div>}
    {state && <>
      <h3>Pending invitations</h3><ul className="vip-access-list">{state.invitations.map(invitation => <li key={invitation.id}><span>{invitation.nickname ? <><strong>{invitation.nickname}</strong><small>{invitation.email}</small></> : invitation.email}<small>Expires {new Date(invitation.expires_at).toLocaleDateString()}</small></span><div className="vip-actions"><button type="button" disabled={busy || loading} onClick={() => void action({ action: "resend_invitation", id: invitation.id }, "")}>Resend email</button>
        {link && linkId === invitation.id ? <button type="button" disabled={busy || loading} onClick={() => void shareLink()}>Share invitation</button> : <button type="button" disabled={busy || loading} onClick={() => void action({ action: "share_invitation", id: invitation.id }, "")}>New share link</button>}
        <button type="button" disabled={busy || loading} onClick={() => void action({ action: "revoke_invitation", id: invitation.id }, "Invitation revoked.")}>Revoke invitation</button></div></li>)}</ul>{!state.invitations.length && <p className="vip-empty">No pending invitations. Choose Invite guest to send one.</p>}
    </>}
    </section>
    <section className="venue-vip-tab-panel" id="venue-vip-panel-members" role="tabpanel" aria-labelledby="venue-vip-tab-members" hidden={section !== "members"} tabIndex={0}>
    {state && <>
        <form className="vip-member-search" role="search" aria-label="Search VIP accounts" onSubmit={searchMembers}>
          <label>Find a VIP<input type="search" maxLength={80} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Guest name or nickname" disabled={busy} /></label>
          <button type="submit" disabled={busy || loading}>Search</button>
          {(searchInput || memberSearch) && <button type="button" disabled={busy || loading} onClick={() => { setSearchInput(""); setError(""); setEditingMember(null); void load(page, "", 0, pendingOnly); }}>Clear search</button>}
        </form>
        {memberSearch && <p className="vip-member-results" role="status">{state.memberCount} {state.memberCount === 1 ? "VIP matches" : "VIPs match"} “{memberSearch}”</p>}
        <ul className="vip-access-list" aria-busy={loading || undefined}>{state.members.map(member => <li key={member.id}>
          <span><strong>{member.nickname || member.display_name}</strong>{member.nickname && <small>{member.display_name}</small>}</span>
          <details className="venue-vip-menu" data-compact-menu><summary aria-label={`More options for ${member.nickname || member.display_name}`}><svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" /></svg></summary><div>
            <button type="button" disabled={busy || loading} aria-label={`${member.nickname ? "Edit" : "Add"} nickname for ${member.display_name}`} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setEditingMember({ id: member.id, nickname: member.nickname || "" }); }}>{member.nickname ? "Edit nickname" : "Add nickname"}</button>
            <button type="button" disabled={busy || loading} onClick={event => { if (window.confirm(`Remove VIP access for ${member.nickname || member.display_name}? Existing requests will remain available for review.`)) { event.currentTarget.closest("details")?.removeAttribute("open"); void action({ action: "revoke_member", id: member.id }, "VIP access removed. Existing requests are still available in Requests."); } }}>Remove VIP access</button>
          </div></details>
          {editingMember?.id === member.id && <form className="vip-nickname-form" onSubmit={saveNickname}>
            <label>Private nickname for {member.display_name}<input autoFocus type="text" maxLength={80} value={editingMember.nickname} onChange={event => setEditingMember({ id: member.id, nickname: event.target.value })} disabled={busy} /></label>
            <small>Venue only. The VIP cannot see or change this nickname.</small>
            <div className="vip-actions"><button type="submit" disabled={busy || loading}>Save nickname</button><button type="button" disabled={busy} onClick={() => setEditingMember(null)}>Cancel</button></div>
          </form>}
        </li>)}</ul>
        {!state.members.length && <p>{memberPage > 0 ? "No VIPs on this page. Return to the previous page." : memberSearch ? "No VIPs match this search." : "Your invited guests will appear here after activating their account."}</p>}
        <div className="vip-actions">
          {memberPage > 0 && <button type="button" disabled={busy || loading} onClick={() => { setEditingMember(null); void load(page, memberSearch, memberPage - 1, pendingOnly); }}>Previous VIPs</button>}
          {state.membersHasMore && <button type="button" disabled={busy || loading} onClick={() => { setEditingMember(null); void load(page, memberSearch, memberPage + 1, pendingOnly); }}>More VIPs</button>}
        </div>
    </>}
    </section>
  </div>;
}
