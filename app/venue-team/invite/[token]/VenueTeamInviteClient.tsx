"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { persistBrowserAuthSession } from "@/src/lib/dancr/browser-session";

type Invitation = {
  email: string;
  role: "manager" | "staff";
  expiresAt: string;
  venue: { name: string; city: string; state: string | null };
};

export default function VenueTeamInviteClient({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Checking invitation…");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/venue/team/invitations?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open this invitation.");
        setInvitation(data.invitation);
        setStatus("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStatus(error instanceof Error ? error.message : "Unable to open this invitation.");
      });
    return () => controller.abort();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setIsWorking(true);
    setStatus(mode === "signup" ? "Creating secure team access…" : "Signing in and accepting…");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          role: "venue",
          email: invitation.email,
          password,
          venueCode: token,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.session?.accessToken) {
        throw new Error(data.error || "Unable to accept this invitation.");
      }
      const sessionSaved = persistBrowserAuthSession({
        accessToken: data.session.accessToken,
        refreshToken: data.session.refreshToken,
        expiresAt: data.session.expiresAt,
        account: data.account || null,
      });
      if (!sessionSaved) {
        throw new Error("Unable to save your venue session in this browser.");
      }
      window.location.assign("/dashboard/venue");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to accept this invitation.");
      setIsWorking(false);
    }
  }

  return (
    <main className="venue-team-invite-shell">
      <section className="venue-team-invite-card">
        <Link className="venue-team-brand" href="/">mydanc</Link>
        {invitation ? (
          <>
            <span className="venue-team-kicker">Venue team invitation</span>
            <h1>Join {invitation.venue.name}</h1>
            <p>
              {invitation.email} has been invited as <strong>{invitation.role}</strong> for {invitation.venue.name} in {invitation.venue.city}{invitation.venue.state ? `, ${invitation.venue.state}` : ""}.
            </p>
            <div className="venue-team-mode" role="tablist" aria-label="Account access mode">
              <button aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} role="tab" type="button" onClick={() => setMode("signup")}>Create account</button>
              <button aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} role="tab" type="button" onClick={() => setMode("login")}>I have an account</button>
            </div>
            <form onSubmit={submit}>
              <label>Email<input value={invitation.email} readOnly type="email" /></label>
              <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
              <button className="venue-team-primary" disabled={isWorking} type="submit">
                {isWorking ? "Please wait…" : mode === "signup" ? "Create account and join" : "Sign in and join"}
              </button>
            </form>
            <small>Invitation expires {new Date(invitation.expiresAt).toLocaleString()}.</small>
          </>
        ) : (
          <h1>{status || "Opening invitation…"}</h1>
        )}
        {invitation && status ? <p className="venue-team-status" role="status">{status}</p> : null}
      </section>
      <style>{`
        .venue-team-invite-shell{min-height:100dvh;display:grid;place-items:center;box-sizing:border-box;padding:24px;background:#050507;color:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.venue-team-invite-card{width:min(100%,520px);display:grid;gap:18px;box-sizing:border-box;padding:28px;border:1px solid #334155;border-radius:20px;background:#111118;box-shadow:0 24px 70px rgba(0,0,0,.45)}.venue-team-brand{width:fit-content;color:#f8fafc;text-decoration:none;font-size:24px;font-weight:950;letter-spacing:-.05em;text-shadow:0 0 15px rgba(124,58,237,.42)}.venue-team-brand::after{content:"r";color:#7c3aed}.venue-team-kicker{color:#94a3b8;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.venue-team-invite-card h1,.venue-team-invite-card p{margin:0}.venue-team-invite-card h1{font-size:clamp(28px,7vw,42px);line-height:1.02}.venue-team-invite-card p{color:#cbd5e1;line-height:1.55}.venue-team-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:5px;border:1px solid #334155;border-radius:13px;background:#050507}.venue-team-mode button,.venue-team-primary{min-height:46px;border:0;border-radius:9px;color:#cbd5e1;background:transparent;font:inherit;font-weight:850;cursor:pointer}.venue-team-mode button.active{color:#fff;background:#7c3aed;box-shadow:0 0 18px rgba(124,58,237,.24)}.venue-team-mode button:focus-visible,.venue-team-primary:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}.venue-team-invite-card form{display:grid;gap:14px}.venue-team-invite-card label{display:grid;gap:7px;color:#cbd5e1;font-size:12px;font-weight:850}.venue-team-invite-card input{min-height:50px;padding:0 14px;border:1px solid #334155;border-radius:11px;color:#f8fafc;background:#050507;font:inherit}.venue-team-invite-card input:focus{outline:2px solid #7c3aed;outline-offset:2px}.venue-team-primary{color:#fff;background:#7c3aed;box-shadow:0 0 18px rgba(124,58,237,.26)}.venue-team-primary:disabled{opacity:.65;cursor:wait}.venue-team-invite-card small{color:#94a3b8}.venue-team-status{padding:12px;border:1px solid rgba(239,68,68,.4);border-radius:10px;color:#fecaca!important;background:rgba(239,68,68,.08)}@media(max-width:540px){.venue-team-invite-shell{padding:14px}.venue-team-invite-card{padding:20px}}
      `}</style>
    </main>
  );
}
