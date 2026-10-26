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
        throw new Error("Unable to save your venue session in this browser.");
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
      <section className="account-entry-card account-panel venue-team-invite-card" aria-labelledby="venue-team-title">
        <Link className="venue-team-back" href="/"><span aria-hidden="true">‹</span> Back to MyDancr</Link>
        <h1 id="venue-team-title">{invitation ? mode === "signup" ? "Create account" : "Sign in" : "Team invitation"}</h1>
        {invitation ? (
          <>
            <div className="account-auth-tabs" role="tablist" aria-label="Account access">
              <button id="venue-team-login" aria-controls="venue-team-form" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} disabled={isWorking} role="tab" type="button" onClick={() => setMode("login")}>Sign in</button>
              <button id="venue-team-signup" aria-controls="venue-team-form" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} disabled={isWorking} role="tab" type="button" onClick={() => setMode("signup")}>Create account</button>
            </div>
            <p className="venue-team-context">
              <span>Join <strong>{invitation.venue.name}</strong> as {invitation.role === "manager" ? "a manager" : "a staff member"}.</span>
              <span>{invitation.venue.city}{invitation.venue.state ? `, ${invitation.venue.state}` : ""}</span>
            </p>
            <form id="venue-team-form" role="tabpanel" aria-labelledby={`venue-team-${mode}`} aria-busy={isWorking} onSubmit={submit}>
              <label htmlFor="venue-team-email">Email<input id="venue-team-email" name="email" value={invitation.email} readOnly type="email" autoComplete="username" /></label>
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
      <style>{`
        body:has(.venue-team-invite-shell) { margin: 0; }
        .venue-team-invite-shell { min-height: 100dvh; box-sizing: border-box; }
        .venue-team-invite-card { width: min(100%, 500px); margin-inline: auto; display: grid; gap: 12px; }
        .venue-team-invite-card h1, .venue-team-invite-card p { margin: 0; }
        .venue-team-back { display: inline-flex; align-items: center; gap: 4px; width: fit-content; min-height: 44px; color: var(--dancr-color-text-muted); font-size: 12px; font-weight: 500; text-decoration: none; }
        .venue-team-back:hover { text-decoration: underline; text-underline-offset: 3px; }
        .venue-team-context { display: grid; gap: 2px; color: var(--dancr-color-text-muted); overflow-wrap: anywhere; }
        .venue-team-context strong { color: var(--dancr-color-text-primary); font-weight: 600; }
        .venue-team-invite-card form, .venue-team-invite-card label { display: grid; }
        .venue-team-invite-card .dancr-password-field { gap: 6px; }
        .venue-team-invite-card [aria-label="Password requirements"], .venue-team-invite-card [aria-label^="Not yet met:"] { color: var(--dancr-color-text-muted) !important; }
        .venue-team-invite-card small { color: var(--dancr-color-text-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .venue-team-status { margin: 0; }
      `}</style>
    </main>
  );
}
