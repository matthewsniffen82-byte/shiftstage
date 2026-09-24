"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { VENUE_TEAM_OWNER_ACCESS_NOTE, VENUE_TEAM_ROLE_DESCRIPTIONS } from "@/src/lib/dancr/venue-team-role-descriptions";
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
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [emailDelivered, setEmailDelivered] = useState<boolean | null>(null);
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const workingRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (clearStatus = true) => {
    if (!mountedRef.current) return;
    const requestId = ++loadSequenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (!readDashboardAccessToken("venue")) {
      if (requestId === loadSequenceRef.current) {
        setIsLoading(false);
        setStatus("Sign in required.");
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      }
      return;
    }
    setIsLoading(true);
    try {
      const data = await requestVenueTeamJson({
        cache: "no-store",
        fallbackMessage: "Unable to load venue team access.",
        signal: controller.signal,
      });
      if (!mountedRef.current || requestId !== loadSequenceRef.current) return;
      setAccess(data.access || null);
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setActivity(data.activity || []);
      if (clearStatus) setStatus("");
    } catch (error) {
      if (!mountedRef.current || requestId !== loadSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      if (clearStatus) setStatus(error instanceof Error ? error.message : "Unable to load venue team access.");
      else setStatus((current) => `${current} The team list could not refresh. Refresh the page to see the latest changes.`.trim());
    } finally {
      if (mountedRef.current && requestId === loadSequenceRef.current) {
        setIsLoading(false);
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      workingRef.current = false;
    };
  }, [load]);

  function beginAction() {
    if (!mountedRef.current || workingRef.current) return null;
    workingRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    setIsLoading(false);
    setIsWorking(true);
    setInviteError(false);
    return { requestId, controller };
  }

  function isCurrentAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    workingRef.current = false;
    if (mountedRef.current) setIsWorking(false);
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readDashboardAccessToken("venue")) {
      setInviteError(true);
      return setStatus("Sign in required.");
    }
    const action = beginAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsInviting(true);
    setInviteError(false);
    setStatus("Sending invitation…");
    setInvitationUrl("");
    setEmailDelivered(null);
    try {
      const data = await requestVenueTeamJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
        fallbackMessage: "Unable to invite this team member.",
        signal: controller.signal,
      });
      if (!isCurrentAction(requestId, controller)) return;
      setEmail("");
      setInvitationUrl(data.invitationUrl || "");
      setEmailDelivered(data.emailDelivered === true);
      setStatus(data.message || "Invitation created.");
      await load(false);
    } catch (error) {
      if (isCurrentAction(requestId, controller)) {
        setInviteError(true);
        setStatus(error instanceof Error ? error.message : "Unable to invite this team member.");
      }
    } finally {
      if (isCurrentAction(requestId, controller)) setIsInviting(false);
      finishAction(requestId);
    }
  }

  async function updateMember(memberId: string, update: { role?: "manager" | "staff"; remove?: boolean }) {
    if (update.remove && !window.confirm("Remove this person's venue dashboard access?")) return;
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    const action = beginAction();
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestVenueTeamJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, ...update }),
        fallbackMessage: "Unable to update venue team access.",
        signal: controller.signal,
      });
      if (!isCurrentAction(requestId, controller)) return;
      await load(false);
      if (!isCurrentAction(requestId, controller)) return;
      setStatus(update.remove ? "Team access removed." : "Team role updated.");
    } catch (error) {
      if (isCurrentAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to update venue team access.");
    } finally {
      finishAction(requestId);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!readDashboardAccessToken("venue")) return setStatus("Sign in required.");
    const action = beginAction();
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestVenueTeamJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId }),
        fallbackMessage: "Unable to revoke this invitation.",
        signal: controller.signal,
      });
      if (!isCurrentAction(requestId, controller)) return;
      await load(false);
      if (!isCurrentAction(requestId, controller)) return;
      setStatus("Invitation revoked.");
    } catch (error) {
      if (isCurrentAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to revoke this invitation.");
    } finally {
      finishAction(requestId);
    }
  }

  async function copyInvitation() {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      if (mountedRef.current) setStatus("Secure invitation link copied.");
    } catch {
      if (mountedRef.current) setStatus("Your browser blocked copying. Open the secure invitation link and copy it from the address bar.");
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
        <form className="venue-team-invite-form" onSubmit={invite} aria-busy={isInviting}>
          <label>Team member email<input type="email" value={email} maxLength={320} required disabled={isInviting} aria-describedby="venue-team-invite-help" onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Access level<select value={role} disabled={isInviting} aria-describedby="venue-team-role-guide" onChange={(event) => setRole(event.target.value as typeof role)}><option value="manager">Manager</option><option value="staff">Staff</option></select></label>
          <small id="venue-team-invite-help" className="venue-team-invite-help">Use an email that isn’t already registered to a guest or dancer account.</small>
          <div id="venue-team-role-guide" className="venue-team-role-guide">
            <div className="venue-team-role-options">
              {(["manager", "staff"] as const).map(level => {
                const description = VENUE_TEAM_ROLE_DESCRIPTIONS[level];
                return <section key={level} className={`venue-team-role-card${role === level ? " is-selected" : ""}`} aria-labelledby={`venue-team-${level}-heading`}>
                  <h3 id={`venue-team-${level}-heading`}>{description.label}{role === level ? <span>Selected</span> : null}</h3>
                  <p><strong>Can view:</strong> {description.view}</p>
                  <p><strong>Can do:</strong> {description.actions}</p>
                </section>;
              })}
            </div>
            <p className="venue-team-owner-note"><strong>Owner access:</strong> {VENUE_TEAM_OWNER_ACCESS_NOTE}</p>
          </div>
          <button className="venue-team-invite-submit" type="submit" disabled={isWorking}>{isInviting ? "Sending invitation…" : "Invite team member"}</button>
        </form>
      ) : (
        <p className="venue-team-permission-note">Only the venue owner can invite people or change team access.</p>
      )}
      {status ? <p className={`venue-team-feedback${inviteError ? " is-error" : ""}`} role={inviteError ? "alert" : "status"}>{status}</p> : null}
      {invitationUrl ? <div className="venue-team-invite-link"><span>{emailDelivered ? "You can also share the secure invitation link directly." : "The invitation is saved. Share this link with the team member to continue."}</span><div><a href={invitationUrl} rel="noreferrer" target="_blank">Open secure link</a><button type="button" onClick={() => void copyInvitation()}>Copy secure link</button></div></div> : null}
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
      <style>{`
        .venue-team-role-guide{grid-column:1 / -1;min-width:0}.venue-team-role-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.venue-team-role-card{min-width:0;padding:12px;border:1px solid #334155;border-radius:10px;background:#0b0b10}.venue-team-role-card.is-selected{border-color:#a78bfa;background:rgba(124,58,237,.08)}.venue-team-role-card h3{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;color:#f8fafc;font-size:14px}.venue-team-role-card h3>span{font-size:10px;font-weight:600;color:#ddd6fe}.venue-team-panel .venue-team-role-card p,.venue-team-panel .venue-team-owner-note{margin:0;color:#b8b6c7;font-size:12px;line-height:1.55}.venue-team-role-card p+p{margin-top:8px!important}.venue-team-role-card p>strong,.venue-team-owner-note>strong{color:#e2e8f0}.venue-team-panel .venue-team-owner-note{margin-top:10px}.venue-team-invite-submit{grid-column:1 / -1;justify-self:start}@media(max-width:760px){.venue-team-role-options{grid-template-columns:1fr}.venue-team-invite-submit{width:100%}}
        .venue-team-invite-help{grid-column:1 / -1;color:#94a3b8;font-size:12px;line-height:1.5}.venue-team-panel .venue-team-feedback{margin:0;padding:12px;border:1px solid rgba(167,139,250,.35);border-radius:10px;color:#ddd6fe;background:rgba(124,58,237,.08);font-size:13px;line-height:1.5;overflow-wrap:anywhere}.venue-team-panel .venue-team-feedback.is-error{border-color:rgba(248,113,113,.4);color:#fecaca;background:rgba(127,29,29,.12)}
        .venue-team-panel{display:grid;gap:16px}.venue-team-heading,.venue-team-subhead,.venue-team-member,.venue-activity-list>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.venue-team-heading h2{margin:4px 0}.venue-team-heading>b,.venue-team-subhead>span{padding:6px 9px;border:1px solid #334155;border-radius:999px;color:#cbd5e1;background:#050507;font-size:10px;text-transform:capitalize}.venue-team-invite-form{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(150px,.7fr);gap:10px;align-items:end}.venue-team-invite-form label{display:grid;gap:6px;color:#cbd5e1;font-size:11px;font-weight:850}.venue-team-invite-form input,.venue-team-invite-form select,.venue-team-member select{min-height:44px;padding:0 11px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#050507;font:inherit}.venue-team-panel button{min-height:42px;padding:0 13px;border:1px solid rgba(124,58,237,.55);border-radius:9px;color:#fff;background:#7c3aed;font:inherit;font-weight:850;cursor:pointer}.venue-team-panel button:disabled{opacity:.6;cursor:wait}.venue-team-panel button:focus-visible,.venue-team-panel input:focus-visible,.venue-team-panel select:focus-visible,.venue-team-invite-link a:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}.venue-team-invite-link,.venue-team-permission-note{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid rgba(16,185,129,.28);border-radius:10px;color:#a7f3d0;background:rgba(16,185,129,.06)}.venue-team-invite-link>div{display:flex;flex-wrap:wrap;gap:8px}.venue-team-invite-link a{min-height:40px;display:inline-flex;align-items:center;padding:0 12px;border:1px solid #334155;border-radius:9px;color:#f8fafc;background:#111118;text-decoration:none;font-size:12px;font-weight:850}.venue-team-list,.venue-activity-list{display:grid;gap:8px;padding-top:14px;border-top:1px solid #334155}.venue-team-subhead{margin-bottom:2px}.venue-team-member,.venue-activity-list>div{padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#0b0b10}.venue-team-member>span,.venue-activity-list>div>span{min-width:0;display:grid;gap:3px}.venue-team-member small,.venue-activity-list small,.venue-activity-list time{color:#94a3b8;font-size:11px}.venue-team-member>b{text-transform:capitalize;color:#cbd5e1}.venue-team-member.owner{border-color:rgba(124,58,237,.26)}.venue-team-remove{border-color:rgba(239,68,68,.35)!important;color:#fecaca!important;background:rgba(239,68,68,.09)!important}.venue-activity-list time{flex:0 0 auto;text-align:right}.venue-activity-list>p{color:#94a3b8}@media(max-width:760px){.venue-team-invite-form{grid-template-columns:1fr}.venue-team-member{align-items:flex-start;flex-wrap:wrap}.venue-team-member>span{width:100%}.venue-team-invite-link{align-items:flex-start;flex-direction:column}.venue-activity-list>div{align-items:flex-start;flex-direction:column}.venue-activity-list time{text-align:left}}
      `}</style>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
