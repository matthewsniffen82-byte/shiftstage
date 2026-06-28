"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type AuthRole = "customer" | "dancer";
type AuthMode = "login" | "signup";

type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: {
    role?: "customer" | "dancer" | "admin";
    displayName?: string | null;
  } | null;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole = searchParams.get("role") === "dancer" ? "dancer" : "customer";
  const [role, setRole] = useState<AuthRole>(initialRole);
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [stageName, setStageName] = useState("");
  const [realName, setRealName] = useState("");
  const [city, setCity] = useState("Las Vegas");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const destination = useMemo(() => (role === "dancer" ? "/dashboard/dancer" : "/dashboard/customer"), [role]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    const payload: Record<string, string> = { mode, role, email, password, city };
    if (role === "customer") payload.name = name;
    if (role === "dancer") {
      payload.stageName = stageName;
      payload.realName = realName;
    }

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");

      if (data.requiresEmailConfirmation || !data.session?.accessToken) {
        setStatus("Check your email to confirm the account before signing in.");
        return;
      }

      const session: AuthSession = {
        accessToken: data.session.accessToken,
        refreshToken: data.session.refreshToken,
        expiresAt: data.session.expiresAt,
        account: data.account,
      };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      router.push(destination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="account-shell">
      <AccountStyles />
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Tonight</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
        </div>
      </nav>

      <section className="account-grid">
        <div className="account-copy">
          <span className="eyebrow">Live account</span>
          <h1>{role === "dancer" ? "Manage your dancer profile." : "Save your night out."}</h1>
          <p>
            Sign in with a live Dancr account to manage saved profiles, notifications, profile setup, and dashboard data.
          </p>
        </div>

        <form className="account-panel" onSubmit={submit}>
          <div className="segmented" aria-label="Account type">
            <button className={role === "customer" ? "active" : ""} type="button" onClick={() => setRole("customer")}>
              Customer
            </button>
            <button className={role === "dancer" ? "active" : ""} type="button" onClick={() => setRole("dancer")}>
              Dancer
            </button>
          </div>

          <div className="segmented" aria-label="Auth mode">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>
              Sign in
            </button>
            <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => setMode("signup")}>
              Create
            </button>
          </div>

          {mode === "signup" && role === "customer" ? (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          ) : null}

          {mode === "signup" && role === "dancer" ? (
            <>
              <label>
                Stage name
                <input value={stageName} onChange={(event) => setStageName(event.target.value)} required />
              </label>
              <label>
                Legal name
                <input value={realName} onChange={(event) => setRealName(event.target.value)} required />
              </label>
            </>
          ) : null}

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {mode === "signup" ? (
            <label>
              City
              <input value={city} onChange={(event) => setCity(event.target.value)} required />
            </label>
          ) : null}

          <button className="submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
          {status ? <p className="status">{status}</p> : null}
        </form>
      </section>
    </main>
  );
}

function AccountStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .account-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.18), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.26), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1080px; margin: 0 auto 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .account-grid { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 430px); gap: clamp(22px, 5vw, 62px); align-items: center; }
      .account-copy { display: grid; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; max-width: 720px; font-size: clamp(42px, 7vw, 82px); line-height: .94; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .account-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: 18px; display: grid; gap: 14px; box-shadow: 0 28px 80px rgba(0,0,0,.38); }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button, .submit { min-height: 42px; border: 0; border-radius: 8px; color: #fff; font-weight: 900; cursor: pointer; }
      .segmented button { background: transparent; }
      .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      .submit { background: #f7f2ff; color: #090911; margin-top: 4px; }
      .submit:disabled { opacity: .62; cursor: wait; }
      .status { color: #94e5ff; font-size: 14px; }
      @media (max-width: 780px) { .account-grid { grid-template-columns: 1fr; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
