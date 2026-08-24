"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  readDashboardAccessToken,
  requestVenueTeamJson,
} from "./dashboard-session";

type Access = { role: "owner" | "manager" | "staff"; permissions: string[] };
type Member = { id: string; role: "manager" | "staff"; status: string; displayName: string; email: string; joinedAt: string };
type Invitation = { id: string; email: string; role: "manager" | "staff"; expiresAt: string };
type Activity = { id: string; actorName: string; actorRole: string; summary: string; createdAt: string };

export default function VenueTeamPanel({ initialAccess }: { initialAccess?: Access | null }) {
  const [access, setAccess] = useState<Access | null>(initialAccess || null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("manager");
  const [status, setStatus] = useState("Loading venue team access…");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");

  const load = useCallback(async (clearStatus = true) => {
    if (!readDashboardAccessToken("venue")) {
      setIsLoading(false);
      return setStatus("Sign in required.");
    }
    setIsLoading(true);
    try {
      const data = await requestVenueTeamJson({
        cache: "no-store",
        fallbackMessage: "Unable to load venue team access.",
      });
      setAccess(data.access || null);
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setActivity(data.activity || []);
      if (clearStatus) setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load venue team access.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    setIsWorking(true);
    setInvitationUrl("");
    try {
      const data = await requestVenueTeamJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
        fallbackMessage: "Unable to invite this team member.",
      });
      setEmail("");
      setInvitationUrl(data.invitationUrl || "");
      setStatus(data.message || "Invitation created.");
      await load(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to invite this team member.");
    } finally {
      setIsWorking(false);
    }
  }

  async function updateMember(memberId: string, update: { role?: "manager" | "staff"; remove?: boolean }) {
    if (update.remove && !window.confirm("Remove this person's venue dashboard access?")) return;
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    setIsWorking(true);
    try {
      await requestVenueTeamJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, ...update }),
        fallbackMessage: "Unable to update venue team access.",
      });
      await load(false);
      setStatus(update.remove ? "Team access removed." : "Team role updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update venue team access.");
    } finally {
      setIsWorking(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    setIsWorking(true);
    try {
      await requestVenueTeamJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId }),
        fallbackMessage: "Unable to revoke this invitation.",
      });
      await load(false);
      setStatus("Invitation revoked.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to revoke this invitation.");
    } finally {
      setIsWorking(false);
    }
  }

  async function copyInvitation() {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setStatus("Secure invitation link copied.");
    } catch {
      setStatus("Your browser blocked copying. Open the secure invitation link and copy it from the address bar.");
    }
  }

  const isOwner = access?.role === "owner";

  return (
    <article className="info-panel venue-team-panel">
      <div className="venue-team-heading">
        <div><span className="eyebrow">Secure venue access</span><h2>Team & activity</h2></div>
        {access ? <b>{access.role}</b> : null}
      </div>
      {isOwner ? (
        <form className="venue-team-invite-form" onSubmit={invite}>
          <label>Team member email<input type="email" value={email} maxLength={320} required onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Access level<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="manager">Manager</option><option value="staff">Staff</option></select></label>
          <button type="submit" disabled={isWorking}>Invite team member</button>
        </form>
      ) : (
        <p className="venue-team-permission-note">Only the venue owner can invite people or change team access.</p>
      )}
      {invitationUrl ? <div className="venue-team-invite-link"><span>Invitation is ready even if email delivery is delayed.</span><div><a href={invitationUrl} rel="noreferrer" target="_blank">Open secure link</a><button type="button" onClick={() => void copyInvitation()}>Copy secure link</button></div></div> : null}
      <section className="venue-team-list" aria-label="Active venue team">
        <div className="venue-team-subhead"><strong>Active team</strong><span>{isLoading && !members.length ? "…" : members.filter((member) => member.status === "active").length + 1}</span></div>
        <div className="venue-team-member owner"><span><strong>Venue owner</strong><small>Full access</small></span><b>Owner</b></div>
        {members.filter((member) => member.status === "active").map((member) => (
          <div className="venue-team-member" key={member.id}>
            <span><strong>{member.displayName}</strong><small>{member.email}</small></span>
            {isOwner ? <select disabled={isWorking} value={member.role} aria-label={`Access level for ${member.displayName}`} onChange={(event) => void updateMember(member.id, { role: event.target.value as Member["role"] })}><option value="manager">Manager</option><option value="staff">Staff</option></select> : <b>{member.role}</b>}
            {isOwner ? <button className="venue-team-remove" type="button" disabled={isWorking} onClick={() => void updateMember(member.id, { remove: true })}>Remove</button> : null}
          </div>
        ))}
      </section>
      {isOwner && invitations.length ? (
        <section className="venue-team-list" aria-label="Pending venue team invitations">
          <div className="venue-team-subhead"><strong>Pending invitations</strong><span>{invitations.length}</span></div>
          {invitations.map((invitation) => <div className="venue-team-member" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.role} · expires {formatDate(invitation.expiresAt)}</small></span><button type="button" disabled={isWorking} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button></div>)}
        </section>
      ) : null}
      <section className="venue-activity-list" aria-label="Venue activity log">
        <div className="venue-team-subhead"><strong>Recent activity</strong><span>{isLoading && !activity.length ? "…" : activity.length}</span></div>
        {activity.map((item) => <div key={item.id}><span><strong>{item.summary}</strong><small>{item.actorName} · {item.actorRole}</small></span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>)}
        {!isLoading && !activity.length ? <p>No venue team changes have been recorded yet.</p> : null}
      </section>
      {status ? <p role="status">{status}</p> : null}
      <style>{`
        .venue-team-panel{display:grid;gap:16px}.venue-team-heading,.venue-team-subhead,.venue-team-member,.venue-activity-list>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-team-heading h2{margin:4px 0}.venue-team-heading>b,.venue-team-subhead>span{padding:6px 9px;border:1px solid #334155;border-radius:999px;color:#cbd5e1;background:#050507;font-size:10px;text-transform:capitalize}.venue-team-invite-form{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(150px,.7fr) auto;gap:10px;align-items:end}.venue-team-invite-form label{display:grid;gap:6px;color:#cbd5e1;font-size:11px;font-weight:850}.venue-team-invite-form input,.venue-team-invite-form select,.venue-team-member select{min-height:44px;padding:0 11px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#050507;font:inherit}.venue-team-panel button{min-height:42px;padding:0 13px;border:1px solid rgba(124,58,237,.55);border-radius:9px;color:#fff;background:#7c3aed;font:inherit;font-weight:850;cursor:pointer}.venue-team-panel button:disabled{opacity:.6;cursor:wait}.venue-team-panel button:focus-visible,.venue-team-panel input:focus-visible,.venue-team-panel select:focus-visible,.venue-team-invite-link a:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}.venue-team-invite-link,.venue-team-permission-note{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid rgba(16,185,129,.28);border-radius:10px;color:#a7f3d0;background:rgba(16,185,129,.06)}.venue-team-invite-link>div{display:flex;flex-wrap:wrap;gap:8px}.venue-team-invite-link a{min-height:40px;display:inline-flex;align-items:center;padding:0 12px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#111118;text-decoration:none;font-size:12px;font-weight:850}.venue-team-list,.venue-activity-list{display:grid;gap:8px;padding-top:14px;border-top:1px solid #334155}.venue-team-subhead{margin-bottom:2px}.venue-team-member,.venue-activity-list>div{padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#0b0b10}.venue-team-member>span,.venue-activity-list>div>span{min-width:0;display:grid;gap:3px}.venue-team-member small,.venue-activity-list small,.venue-activity-list time{color:#94a3b8;font-size:11px}.venue-team-member>b{text-transform:capitalize;color:#cbd5e1}.venue-team-member.owner{border-color:rgba(124,58,237,.26)}.venue-team-remove{border-color:rgba(239,68,68,.35)!important;color:#fecaca!important;background:rgba(239,68,68,.09)!important}.venue-activity-list time{flex:0 0 auto;text-align:right}.venue-activity-list>p{color:#94a3b8}@media(max-width:760px){.venue-team-invite-form{grid-template-columns:1fr}.venue-team-member{align-items:flex-start;flex-wrap:wrap}.venue-team-member>span{width:100%}.venue-team-invite-link{align-items:flex-start;flex-direction:column}.venue-activity-list>div{align-items:flex-start;flex-direction:column}.venue-activity-list time{text-align:left}}
      `}</style>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
