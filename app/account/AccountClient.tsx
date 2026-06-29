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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stageName, setStageName] = useState("");
  const [realName, setRealName] = useState("");
  const [city, setCity] = useState("Las Vegas");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const destination = useMemo(() => (role === "dancer" ? "/dashboard/dancer" : "/dashboard/customer"), [role]);

  function clearFields() {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setStageName("");
    setRealName("");
    setCity("Las Vegas");
    setStatus("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  function chooseRole(nextRole: AuthRole) {
    setRole(nextRole);
    clearFields();
  }

  function chooseMode(nextMode: AuthMode) {
    setMode(nextMode);
    clearFields();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (mode === "signup" && role === "customer" && password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const payload: Record<string, string> = { mode, role, email, password, city };
    if (role === "dancer") {
      payload.stageName = stageName;
      payload.realName = realName;
    }
    if (mode === "signup" && typeof window !== "undefined") {
      const returnTo = role === "dancer" ? "/dashboard/dancer" : "/dashboard/customer";
      payload.emailRedirectTo = `${window.location.origin}/auth/callback?dancr_confirm=1&role=${encodeURIComponent(role)}&return_to=${encodeURIComponent(returnTo)}`;
    }

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(friendlyAuthErrorMessage(data.error, "Unable to sign in."));

      if (mode === "signup") {
        setStatus(
          role === "customer"
            ? "Check your email to confirm the account. After confirmation, Dancr will open your customer dashboard."
            : "Check your email to confirm the account before continuing.",
        );
        window.localStorage.removeItem(SESSION_KEY);
        return;
      }

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
      setStatus(friendlyAuthErrorMessage(error instanceof Error ? error.message : "", "Unable to sign in."));
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
          <Link href="/tonight">Now</Link>
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
            <button className={role === "customer" ? "active" : ""} type="button" onClick={() => chooseRole("customer")}>
              Customer
            </button>
            <button className={role === "dancer" ? "active" : ""} type="button" onClick={() => chooseRole("dancer")}>
              Dancer
            </button>
          </div>

          <div className="segmented" aria-label="Auth mode">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => chooseMode("login")}>
              Sign in
            </button>
            <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => chooseMode("signup")}>
              Create
            </button>
          </div>

          {mode === "signup" && role === "customer" ? (
            <>
              <section className="signup-benefits" aria-label="Customer signup benefits">
                <span className="eyebrow">Why join</span>
                <h2>Your private nightlife dashboard</h2>
                <ul>
                  <li>Follow dancers and venues privately.</li>
                  <li>Save club deal QR codes to your dashboard.</li>
                  <li>See who you follow working now.</li>
                  <li>Keep alerts, favorites, and directions in one place.</li>
                </ul>
                <p>Confirm your email, then Dancr opens your customer dashboard.</p>
              </section>
            </>
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
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                type="button"
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
          </label>
          {mode === "signup" && role === "customer" ? (
            <label>
              Confirm password
              <span className="password-control">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
                <button
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </span>
            </label>
          ) : null}
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

function friendlyAuthErrorMessage(message: string | undefined, fallback: string) {
  const text = message || fallback;
  if (/rate limit/i.test(text)) {
    return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
  }

  return text;
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
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 46px; }
      .password-control button { position: absolute; right: 8px; width: 30px; height: 30px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #d8cfeb; background: rgba(255,255,255,.055); cursor: pointer; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(155,92,255,.18); box-shadow: 0 0 16px rgba(155,92,255,.18); }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .submit { background: #f7f2ff; color: #090911; margin-top: 4px; }
      .submit:disabled { opacity: .62; cursor: wait; }
      .status { color: #94e5ff; font-size: 14px; }
      .signup-benefits { display: grid; gap: 10px; padding: 14px; border: 1px solid rgba(34,199,255,.28); border-radius: 8px; background: linear-gradient(135deg, rgba(34,199,255,.08), rgba(139,92,246,.14)); }
      .signup-benefits h2 { margin: 0; font-size: 20px; }
      .signup-benefits ul { display: grid; gap: 7px; margin: 0; padding-left: 18px; color: #d8cfeb; font-weight: 750; }
      .signup-benefits p { font-size: 14px; line-height: 1.45; }
      @media (max-width: 780px) { .account-grid { grid-template-columns: 1fr; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
