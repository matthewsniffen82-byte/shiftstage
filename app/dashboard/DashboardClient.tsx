"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DashboardRole = "customer" | "dancer";

type LoadState = {
  account?: { displayName?: string | null; email?: string | null; role?: string; accountState?: string } | null;
  profile?: Record<string, unknown> | null;
  saved?: {
    dancers?: unknown[];
    favoriteDancers?: unknown[];
    venues?: unknown[];
    notifiedDancers?: unknown[];
    going?: unknown[];
  } | null;
  analytics?: Record<string, unknown> | null;
  error?: string;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function DashboardClient({ role }: { role: DashboardRole }) {
  const [state, setState] = useState<LoadState>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = readSession();
      if (!session?.accessToken) {
        setState({ error: "Sign in to open this dashboard." });
        setIsLoading(false);
        return;
      }

      try {
        const authHeaders = { authorization: `Bearer ${session.accessToken}` };
        const account = await readJson("/api/account", authHeaders);
        const profile = await readJson(role === "dancer" ? "/api/dancer/profile" : "/api/customer/profile", authHeaders);
        const secondary = await readJson(role === "dancer" ? "/api/dancer/dashboard" : "/api/customer/saved", authHeaders);

        if (!cancelled) {
          setState({
            account: account.account,
            profile: profile.profile,
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
          });
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setState({ error: error instanceof Error ? error.message : "Unable to load dashboard." });
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const title = useMemo(() => {
    if (role === "dancer") return "Dancer dashboard";
    return "Customer dashboard";
  }, [role]);

  const displayName = String(state.account?.displayName || dashboardName(state.profile, role) || "Dancr");

  return (
    <main className="dashboard-shell">
      <DashboardStyles />
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Tonight</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <section className="dashboard-head">
        <span className="eyebrow">Live account</span>
        <h1>{title}</h1>
        <p>{isLoading ? "Loading your live account..." : state.error ? state.error : `Welcome back, ${displayName}.`}</p>
        {state.error ? <Link className="primary-link" href={`/account?role=${role}`}>Sign in</Link> : null}
      </section>

      {!state.error ? (
        <section className="dashboard-grid">
          <InfoPanel title="Account">
            <Metric label="Status" value={String(state.account?.accountState || "active")} />
            <Metric label="Email" value={String(state.account?.email || "Private")} />
            <Metric label="Role" value={String(state.account?.role || role)} />
          </InfoPanel>

          {role === "customer" ? <CustomerPanel saved={state.saved} profile={state.profile} /> : null}
          {role === "dancer" ? <DancerPanel analytics={state.analytics} profile={state.profile} /> : null}
        </section>
      ) : null}
    </main>
  );
}

function CustomerPanel({ saved, profile }: { saved?: LoadState["saved"]; profile?: LoadState["profile"] }) {
  return (
    <>
      <InfoPanel title="Preferences">
        <Metric label="City" value={String(profile?.city || "Las Vegas")} />
        <Metric label="Followed dancers" value={String(saved?.dancers?.length || 0)} />
        <Metric label="Favorite dancers" value={String(saved?.favoriteDancers?.length || 0)} />
      </InfoPanel>
      <InfoPanel title="Tonight">
        <Metric label="Followed venues" value={String(saved?.venues?.length || 0)} />
        <Metric label="Notifications" value={String(saved?.notifiedDancers?.length || 0)} />
        <Metric label="Going" value={String(saved?.going?.length || 0)} />
      </InfoPanel>
    </>
  );
}

function DancerPanel({ analytics, profile }: { analytics?: LoadState["analytics"]; profile?: LoadState["profile"] }) {
  return (
    <>
      <InfoPanel title="Profile">
        <Metric label="Stage name" value={String(profile?.stage_name || profile?.stageName || "Draft")} />
        <Metric label="Status" value={String(profile?.status || "draft")} />
        <Metric label="Photo review" value={String(profile?.photo_review_status || "pending")} />
      </InfoPanel>
      <InfoPanel title="Last 30 days">
        <Metric label="Current rank" value={String(analytics?.currentRank || "Unranked")} />
        <Metric label="Profile views" value={String(analytics?.profileViews30Days || 0)} />
        <Metric label="Going signals" value={String(analytics?.goingSignals30Days || 0)} />
      </InfoPanel>
    </>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="info-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function readSession(): { accessToken?: string } | null {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

async function readJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load dashboard.");
  return data;
}

function dashboardName(profile: Record<string, unknown> | null | undefined, role: DashboardRole) {
  if (!profile) return "";
  if (role === "dancer") return profile.stage_name || profile.stageName || "";
  return "";
}

function DashboardStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .dashboard-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.16), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav, .dashboard-head, .dashboard-grid { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a, .primary-link { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .dashboard-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(40px, 7vw, 76px); line-height: .94; letter-spacing: 0; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .info-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: 16px; display: grid; gap: 14px; }
      .info-panel > div { display: grid; gap: 10px; }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      @media (max-width: 860px) { .dashboard-grid { grid-template-columns: 1fr; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
