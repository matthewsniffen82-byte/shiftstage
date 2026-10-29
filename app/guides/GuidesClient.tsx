"use client";
import RefreshButton from "../components/RefreshButton";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentDashboardAuthHeaders, persistResponseSession, readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { GUIDE_DOCUMENTS, GUIDE_ROLES, OPERATIONS_SUPPORT_EMAIL } from "@/src/lib/dancr/operations-guides";

type Catalog = { accountId: string; role: string; venueName: string | null; documents: string[] };

export default function GuidesClient() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const loadRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const accountId = useRef<unknown>(null);

  const load = useCallback(async () => {
    loadRequest.current?.abort();
    downloadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    const expectedId = readSession()?.account?.id;
    accountId.current = expectedId;
    setCatalog(null); setError(""); setNotice(""); setBusy(""); setLoading(true);
    try {
      if (!currentDashboardAuthHeaders()) return;
      const data = await requestDashboardJson("/api/guides", {
        cache: "no-store", signal: controller.signal, timeoutMs: 20000,
        fallbackMessage: "Unable to check guide access. Please try again.",
      });
      if (!controller.signal.aborted && readSession()?.account?.id === expectedId) setCatalog(data);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load guides.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const changed = (event: StorageEvent) => {
      if ((!event.key || event.key === BROWSER_AUTH_SESSION_KEY) && readSession()?.account?.id !== accountId.current) void load();
    };
    const returned = () => { if (readSession()?.account?.id !== accountId.current) void load(); };
    window.addEventListener("storage", changed);
    window.addEventListener("pageshow", returned);
    return () => {
      loadRequest.current?.abort(); downloadRequest.current?.abort();
      window.removeEventListener("storage", changed); window.removeEventListener("pageshow", returned);
    };
  }, [load]);

  async function download(id: string) {
    if (downloadRequest.current && !downloadRequest.current.signal.aborted) return;
    const documentInfo = GUIDE_DOCUMENTS.find(document => document.id === id);
    const headers = currentDashboardAuthHeaders();
    if (!documentInfo || !headers || !catalog?.documents.includes(id)) return;
    const expectedId = readSession()?.account?.id;
    const controller = new AbortController();
    downloadRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    setBusy(id); setNotice("");
    try {
      const response = await fetch(`/api/guides?document=${encodeURIComponent(id)}`, {
        headers, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Unable to download this guide. Refresh access and try again.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted || readSession()?.account?.id !== expectedId) return;
      if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("The PDF could not be confirmed. Please try again.");
      persistResponseSession({ session: {
        accessToken: response.headers.get("x-dancr-session-access") || undefined,
        refreshToken: response.headers.get("x-dancr-session-refresh") || undefined,
        expiresAt: Number(response.headers.get("x-dancr-session-expires")) || undefined,
      } }, headers);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = documentInfo.file;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("Your PDF is ready. Check your browser's downloads or Files app.");
    } catch (cause) {
      if (timedOut && downloadRequest.current === controller) setNotice("The download took too long. Please try again.");
      else if (!controller.signal.aborted) setNotice(cause instanceof Error ? cause.message : "Download failed. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      if (downloadRequest.current === controller) { downloadRequest.current = null; setBusy(""); }
    }
  }

  const back = catalog?.role === "admin" ? "/admin" : catalog?.role === "venue" ? "/dashboard/venue" : catalog?.role === "dancer" ? "/dashboard/dancer" : "/";
  return <main className="operations-guides" data-global-navigation-swipe="ignore">
    <nav className="guides-topline" aria-label="Page navigation"><Link href={back}>‹ Back to MyDancr</Link><span>TEAM TRAINING</span></nav>
    <header className="guides-heading"><p className="guides-kicker">MYDANCR OPERATIONS</p><h1>Operations manual &amp; role guides</h1><p>Learn each task with illustrated instructions and app examples. Download your role guide and keep a checklist handy during your shift.</p></header>
    <section className="guides-access" aria-label="Download access" aria-busy={loading}>
      {loading ? <p role="status">Checking your guide access…</p> : catalog ? <><p>{catalog.venueName ? `Guides for ${catalog.venueName}` : "Your guide access is ready."}</p><RefreshButton label="Refresh guide access" busy={loading} type="button" onClick={() => void load()} disabled={Boolean(busy)} /></> : <><p>Sign in to download the guides for your role, then return here.</p><div className="guides-signin"><Link href="/account?role=dancer&mode=login&return_to=%2Fguides">Dancer sign in</Link><Link href="/?venueAccess=1&venueMode=login&return_to=%2Fguides">Club sign in</Link><Link href="/admin">Platform admin</Link><button type="button" onClick={() => void load()}>Check access again</button></div></>}
      {error ? <p className="guides-error" role="alert">{error}</p> : null}
      {catalog && !catalog.documents.length ? <p>Your account has no guide downloads. Club owners and managers can provide staff training; contact your club owner if your access is incorrect.</p> : null}
    </section>
    <div className="guides-grid">
      {GUIDE_ROLES.map((role, index) => {
        const available = Boolean(catalog?.documents.includes(`${role.id}-guide`));
        return <article className="guide-card" key={role.id}>
          <div className="guide-card-top"><span className="guide-number">0{index + 1}</span><span>{role.pages} pages · PDF</span></div>
          <h2>{role.title}</h2><p>{role.description}</p>
          <div className="guide-actions">
            <button type="button" disabled={!available || Boolean(busy)} onClick={() => void download(`${role.id}-guide`)} aria-label={`Download ${role.title} onboarding guide`}>{busy === `${role.id}-guide` ? "Preparing PDF…" : "↓ Onboarding guide"}</button>
            <button type="button" className="guide-cheat" disabled={!available || Boolean(busy)} onClick={() => void download(`${role.id}-cheat-sheet`)} aria-label={`Download ${role.title} one-page cheat sheet`}>{busy === `${role.id}-cheat-sheet` ? "Preparing PDF…" : "↓ Quick cheat sheet"}</button>
          </div>
          {!available ? <p className="guide-access-note">{role.id === "dancer" ? "For dancers, club owners, managers and platform admins." : "For club owners, managers and platform admins."}</p> : <p className="guide-access-note">Cheat sheet: 1 page</p>}
        </article>;
      })}
    </div>
    <p className="guides-notice" role="status" aria-live="polite">{notice}</p>
    {catalog?.documents.includes("operations-packet") ? <section className="guides-reference"><div><h2>Operations manual &amp; cheat sheets</h2><p>50 pages: a new 46-page manual with 41 procedures, plus four one-page cheat sheets.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void download("operations-packet")}>{busy === "operations-packet" ? "Preparing PDF…" : "↓ Download complete PDF"}</button></section> : null}
    <section className="guides-help" aria-labelledby="guides-help-title"><h2 id="guides-help-title">Know who to contact</h2><dl>
      <div><dt>Club access</dt><dd>Your club owner manages team invitations and access.</dd></div>
      <div><dt>Pending or rejected uploads</dt><dd>Your club’s assigned media reviewer explains the decision and required correction.</dd></div>
      <div><dt>Urgent club issues</dt><dd>Contact the duty manager directly for current-shift problems.</dd></div>
      <div><dt>MyDancr account or technical support</dt><dd><a href={`mailto:${OPERATIONS_SUPPORT_EMAIL}`}>{OPERATIONS_SUPPORT_EMAIL}</a><span>Include the club, issue and record reference. Keep passwords and ID documents out of email.</span></dd></div>
    </dl><p className="guides-small">Ask your club owner for the named contact for each duty before your first shift.</p></section>
    <footer className="guides-footer">Club manager quick guide: 29 October 2026, with simplified illustrations and a shift checklist. Other guides and the complete packet: 21 October 2026. Illustrations and component screenshots use sample information.</footer>
  </main>;
}
