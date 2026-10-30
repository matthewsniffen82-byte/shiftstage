"use client";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { PasswordField } from "@/app/components/PasswordField";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { captureBrowserAuthSessionGuard, persistBrowserAuthSession } from "@/src/lib/dancr/browser-session";

type Invitation = {
  email: string;
  role: "manager" | "staff";
  accepted?: boolean;
  expiresAt: string | null;
  venue: { name: string; city: string; state: string | null };
};

export default function VenueTeamInviteClient({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Checking invitation…");
  const [isWorking, setIsWorking] = useState(false);
  const mountedRef = useRef(false);
  const submitAbortRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitAbortRef.current?.abort();
      submitInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    submitAbortRef.current?.abort();
    submitAbortRef.current = null;
    submitInFlightRef.current = false;
    setInvitation(null);
    setPassword("");
    setIsWorking(false);
    setStatus("Checking invitation…");
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
        if (data.invitation.accepted) setMode("login");
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
    if (!invitation || submitInFlightRef.current) return;
    const isSessionUnchanged = captureBrowserAuthSessionGuard();
    const controller = new AbortController();
    submitAbortRef.current?.abort();
    submitAbortRef.current = controller;
    submitInFlightRef.current = true;
    setIsWorking(true);
    setStatus(mode === "signup" ? "Creating secure team access…" : "Signing in and accepting…");
    let redirecting = false;
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
        signal: controller.signal,
      });
      const data = await response.json();
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !data.ok || !data.session?.accessToken) {
        throw new Error(data.error || "Unable to accept this invitation.");
      }
      if (!isSessionUnchanged()) throw new Error("Your sign-in changed in another window. Your invitation was accepted; sign in with the invited email to continue.");
      const sessionSaved = persistBrowserAuthSession({
        accessToken: data.session.accessToken,
        refreshToken: data.session.refreshToken,
        expiresAt: data.session.expiresAt,
        account: data.account || null,
      });
      if (!sessionSaved) {
        throw new Error("Unable to save your club session in this browser.");
      }
      redirecting = true;
      window.location.assign("/dashboard/venue");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : "Unable to accept this invitation.");
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
        submitInFlightRef.current = false;
        if (mountedRef.current && !redirecting) setIsWorking(false);
      }
    }
  }

  return (
    <main className="account-shell venue-team-invite-shell">
      <div className="page-inner">
        <section className="account-entry-card account-panel auth-card auth-choice-card venue-team-invite-card" aria-labelledby="venue-team-title">
          <header className="page-head">
            <Link className="dancr-home-back" href="/"><span aria-hidden="true">‹</span> Back to MyDancr</Link>
            <div><h1 id="venue-team-title">{invitation ? mode === "signup" ? "Create account" : "Sign in" : "Team invitation"}</h1></div>
          </header>
          {invitation ? (
            <>
              <div className="account-auth-tabs" role="tablist" aria-label="Account access">
                <button id="venue-team-login" aria-controls="venue-team-form" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} disabled={isWorking} role="tab" type="button" onClick={() => setMode("login")}>Sign in</button>
                <button id="venue-team-signup" aria-controls="venue-team-form" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} disabled={isWorking} role="tab" type="button" onClick={() => setMode("signup")}>Create account</button>
              </div>
              <div className="auth-selected-role venue-team-context">
                <span>{invitation.role === "manager" ? "Manager" : "Staff"} invitation · {invitation.venue.name}, {invitation.venue.city}{invitation.venue.state ? `, ${invitation.venue.state}` : ""}.</span>
              </div>
              <form className="auth-form" id="venue-team-form" role="tabpanel" aria-labelledby={`venue-team-${mode}`} aria-busy={isWorking} onSubmit={submit}>
                <div className="field"><label htmlFor="venue-team-email">Email</label><input id="venue-team-email" name="email" value={invitation.email} readOnly type="email" autoComplete="username" /></div>
                <PasswordField key={mode} id="venue-team-password" name="password" label="Password" value={password} disabled={isWorking} onChange={(event) => setPassword(event.target.value)} minLength={mode === "signup" ? 6 : undefined} required autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                <PasswordRequirements password={password} />
                {status ? <p className="status venue-team-status" role="status">{status}</p> : null}
                <button className="venue-team-primary" data-sign-in-action={mode === "login" || undefined} aria-busy={isWorking} disabled={isWorking} type="submit">
                  {isWorking ? "Please wait…" : mode === "signup" ? "Create account and join" : "Sign in and join"}
                </button>
              </form>
              <small>{invitation.expiresAt ? `Invitation expires ${new Date(invitation.expiresAt).toLocaleString()}.` : "This invitation stays available until you join the team, unless it is revoked or replaced."}</small>
            </>
          ) : (
            <p role="status">{status || "Opening invitation…"}</p>
          )}
        </section>
      </div>
      <style>{`
        body:has(.venue-team-invite-shell) { margin: 0; }
        .venue-team-context { color: var(--dancr-color-text-muted); overflow-wrap: anywhere; }
        .venue-team-invite-card [aria-label="Password requirements"], .venue-team-invite-card [aria-label^="Not yet met:"] { color: var(--dancr-color-text-muted) !important; }
        .venue-team-invite-card [aria-label="Password requirements"] li { display: list-item !important; }
        .venue-team-invite-card [aria-label="Password requirements"] li > span { display: none; }
        .venue-team-invite-card [aria-label^="Met:"]::marker { content: "✓  "; }
        .venue-team-invite-card small { color: var(--dancr-color-text-muted); font-size: 12px; font-weight: 400; line-height: 1.5; overflow-wrap: anywhere; }
        .venue-team-status { margin: 0; }
      `}</style>
    </main>
  );
}
