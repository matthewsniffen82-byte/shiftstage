"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DashboardRole = "customer" | "dancer";

type LoadState = {
  account?: { displayName?: string | null; email?: string | null; role?: string; accountState?: string } | null;
  profile?: Record<string, unknown> | null;
  saved?: {
    follows?: Array<{ notificationsEnabled?: boolean }>;
    favorites?: unknown[];
    venueFollows?: unknown[];
    goingSignals?: unknown[];
  } | null;
  analytics?: Record<string, unknown> | null;
  reviews?: Array<Record<string, unknown>>;
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
        const reviews = role === "dancer" ? await readJson("/api/dancer/reviews", authHeaders) : null;

        if (!cancelled) {
          setState({
            account: account.account,
            profile: profile.profile,
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
            reviews: reviews?.reviews || [],
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
          {role === "dancer" ? <DancerPanel analytics={state.analytics} profile={state.profile} reviews={state.reviews} /> : null}
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
        <Metric label="Followed dancers" value={String(saved?.follows?.length || 0)} />
        <Metric label="Favorite dancers" value={String(saved?.favorites?.length || 0)} />
      </InfoPanel>
      <InfoPanel title="Tonight">
        <Metric label="Followed venues" value={String(saved?.venueFollows?.length || 0)} />
        <Metric
          label="Notifications"
          value={String(saved?.follows?.filter((item) => item.notificationsEnabled).length || 0)}
        />
        <Metric label="Going" value={String(saved?.goingSignals?.length || 0)} />
      </InfoPanel>
    </>
  );
}

function DancerPanel({
  analytics,
  profile,
  reviews,
}: {
  analytics?: LoadState["analytics"];
  profile?: LoadState["profile"];
  reviews?: LoadState["reviews"];
}) {
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
      <DancerSetupPanel profile={profile} />
      <DancerPhotoPanel />
      <DancerVerificationPanel reviews={reviews} />
      <DancerShiftPanel city={String(profile?.city || "Las Vegas")} />
      <DancerBillingPanel />
    </>
  );
}

function DancerSetupPanel({ profile }: { profile?: LoadState["profile"] }) {
  const [stageName, setStageName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setStageName(String(profile?.stage_name || profile?.stageName || ""));
    setLegalName(String(profile?.real_name || profile?.realName || ""));
    setCity(String(profile?.city || "Las Vegas"));
    setBio(String(profile?.bio || ""));
  }, [profile]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ stageName, legalName, city, bio }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save profile.");
      setStatus("Profile saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save profile.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="info-panel setup-panel">
      <h2>Setup</h2>
      <form onSubmit={saveProfile}>
        <label>
          Stage name
          <input value={stageName} onChange={(event) => setStageName(event.target.value)} required />
        </label>
        <label>
          Legal name
          <input value={legalName} onChange={(event) => setLegalName(event.target.value)} required />
        </label>
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} />
        </label>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save profile"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
}

function DancerBillingPanel() {
  const [billing, setBilling] = useState<Record<string, any> | null>(null);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;

    fetch("/api/dancer/billing", { headers: { authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (data.ok) setBilling(data.billing);
        else setStatus(data.error || "Unable to load billing.");
      })
      .catch(() => setStatus("Unable to load billing."));
  }, []);

  async function openBilling(path: string, urlKey: "checkoutUrl" | "portalUrl") {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsWorking(true);
    setStatus("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open billing.");
      if (data[urlKey]) window.location.href = data[urlKey];
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to open billing.");
    } finally {
      setIsWorking(false);
    }
  }

  const subscription = billing?.subscription || {};

  return (
    <article className="info-panel billing-panel">
      <h2>Billing</h2>
      <div className="billing-grid">
        <Metric label="Profile" value={String(billing?.dancerStatus || "pending")} />
        <Metric label="Subscription" value={String(subscription.status || "not_started")} />
        <Metric
          label="Renews"
          value={subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "Not active"}
        />
      </div>
      <div className="billing-actions">
        <button type="button" disabled={isWorking} onClick={() => openBilling("/api/dancer/billing/checkout", "checkoutUrl")}>
          Start subscription
        </button>
        <button type="button" disabled={isWorking} onClick={() => openBilling("/api/dancer/billing/portal", "portalUrl")}>
          Manage billing
        </button>
        {status ? <p>{status}</p> : null}
      </div>
    </article>
  );
}

function DancerShiftPanel({ city }: { city: string }) {
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<Record<string, any>>>([]);
  const [venueId, setVenueId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;

    fetch(`/api/public/venues?city=${encodeURIComponent(city)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        setVenues(data.venues || []);
        setVenueId((current) => current || data.venues?.[0]?.id || "");
      })
      .catch(() => undefined);

    loadShifts(session.accessToken);
  }, [city]);

  async function loadShifts(accessToken: string) {
    const response = await fetch("/api/dancer/shifts", { headers: { authorization: `Bearer ${accessToken}` } });
    const data = await response.json();
    if (response.ok && data.ok) setShifts(data.shifts || []);
  }

  async function postShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!venueId || !startsAt || !endsAt) {
      setStatus("Choose a venue, start time, and end time.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/shifts", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to post shift.");
      setStatus(`Shift posted. ${data.broadcastRecipients || 0} followers notified.`);
      setStartsAt("");
      setEndsAt("");
      await loadShifts(session.accessToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to post shift.");
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setStatus("");
    const response = await fetch("/api/dancer/shifts", {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ shiftId, status: "cancelled" }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to cancel shift.");
      return;
    }
    setStatus(`Shift cancelled. ${data.cancellationRecipients || 0} customers notified.`);
    await loadShifts(session.accessToken);
  }

  return (
    <article className="info-panel shift-panel">
      <h2>Shifts</h2>
      <form onSubmit={postShift}>
        <label>
          Venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} required>
            <option value="">Choose venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label>
          Ends
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Posting..." : "Post shift"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      <div className="shift-list">
        {shifts.slice(0, 8).map((shift) => (
          <div className="dashboard-shift" key={String(shift.id)}>
            <span>
              <strong>{venueName(shift)}</strong>
              <small>{formatDashboardShift(shift.starts_at, shift.ends_at)}</small>
            </span>
            <em>{String(shift.status || "posted")}</em>
            {shift.status !== "cancelled" ? (
              <button type="button" onClick={() => cancelShift(String(shift.id))}>
                Cancel
              </button>
            ) : null}
          </div>
        ))}
        {!shifts.length ? <p>No shifts posted yet.</p> : null}
      </div>
    </article>
  );
}

function venueName(shift: Record<string, any>) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}

function formatDashboardShift(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return "Time pending";
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

function DancerVerificationPanel({ reviews }: { reviews?: LoadState["reviews"] }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!file) {
      setStatus("Choose a document first.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    setIsUploading(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/verification-documents", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to upload verification document.");
      setStatus("Verification document uploaded.");
      setFile(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload verification document.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <article className="info-panel verification-panel">
      <h2>Verification</h2>
      <form onSubmit={uploadDocument}>
        <label>
          Identity document
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload document"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      <div className="review-list">
        {(reviews || []).slice(0, 4).map((review) => (
          <div className="review-row" key={String(review.id || `${review.reviewType}-${review.createdAt}`)}>
            <strong>{String(review.reviewType || "Review")}</strong>
            <span>{String(review.status || "pending")}</span>
            {review.notes ? <p>{String(review.notes)}</p> : null}
          </div>
        ))}
        {!reviews?.length ? <p>No review notes yet.</p> : null}
      </div>
    </article>
  );
}

function DancerPhotoPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [isPrimary, setIsPrimary] = useState(true);
  const [photoUrl, setPhotoUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  async function uploadPhoto(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!file) {
      setStatus("Choose a photo first.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    formData.set("isPrimary", String(isPrimary));

    setIsUploading(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/photos", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to upload photo.");
      setPhotoUrl(data.photo?.imageUrl || "");
      setStatus("Photo uploaded for review.");
      setFile(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload photo.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <article className="info-panel upload-panel">
      <h2>Photos</h2>
      <form onSubmit={uploadPhoto}>
        <label>
          Profile photo
          <input
            accept="image/jpeg,image/png,image/webp"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <label className="check-row">
          <input checked={isPrimary} type="checkbox" onChange={(event) => setIsPrimary(event.target.checked)} />
          Primary photo
        </label>
        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload photo"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      {photoUrl ? <div className="photo-preview" style={{ backgroundImage: `url(${photoUrl})` }} /> : null}
    </article>
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
      .setup-panel { grid-column: span 3; }
      .setup-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .setup-panel label, .upload-panel label, .verification-panel label, .shift-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .setup-panel label:nth-of-type(4) { grid-column: span 3; }
      .setup-panel input, .setup-panel textarea, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .setup-panel input, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select { min-height: 42px; }
      .setup-panel textarea { resize: vertical; min-height: 108px; }
      .setup-panel button, .upload-panel button, .verification-panel button, .shift-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; }
      .setup-panel button:disabled, .upload-panel button:disabled, .verification-panel button:disabled, .shift-panel button:disabled { opacity: .62; cursor: wait; }
      .setup-panel p, .upload-panel p, .verification-panel p, .shift-panel p { color: #94e5ff; font-size: 14px; }
      .upload-panel, .verification-panel, .shift-panel, .billing-panel { grid-column: span 3; }
      .upload-panel form, .verification-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: end; }
      .shift-panel form { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
      .check-row { min-height: 42px; display: flex !important; align-items: center; gap: 9px !important; padding-bottom: 10px; }
      .check-row input { width: 18px; height: 18px; }
      .photo-preview { width: 180px; aspect-ratio: 3 / 4; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,.12); }
      .review-list { display: grid; gap: 10px; }
      .review-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .review-row span { color: #94e5ff; font-size: 13px; font-weight: 850; text-transform: capitalize; }
      .shift-list { display: grid; gap: 10px; }
      .dashboard-shift { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .dashboard-shift span { display: grid; gap: 4px; }
      .dashboard-shift small { color: #b9accd; }
      .dashboard-shift em { color: #94e5ff; font-style: normal; font-weight: 850; text-transform: capitalize; }
      .dashboard-shift button { color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); padding: 0 12px; }
      .billing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .billing-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .billing-actions button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .billing-actions p { color: #94e5ff; font-size: 14px; }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      @media (max-width: 860px) { .dashboard-grid, .setup-panel form, .upload-panel form, .verification-panel form, .shift-panel form, .dashboard-shift, .billing-grid { grid-template-columns: 1fr; } .setup-panel, .upload-panel, .verification-panel, .shift-panel, .billing-panel, .setup-panel label:nth-of-type(4) { grid-column: auto; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
