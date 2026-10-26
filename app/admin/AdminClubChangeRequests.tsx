"use client";

import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";
import AdminInboxActions from "./AdminInboxActions";
import styles from "./admin-club-change-requests.module.css";

export type ClubChangeRequest = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  page_review_status: "changes_requested";
  page_review_notes: string | null;
  page_reviewed_at: string | null;
  updated_at: string;
};

export default function AdminClubChangeRequests({ visible, onOpen, onCountChange }: {
  visible: boolean;
  onOpen: (request: ClubChangeRequest) => void;
  onCountChange: (count: number | null) => void;
}) {
  const [requests, setRequests] = useState<ClubChangeRequest[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [hasMore, setHasMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true; setLoading(true);
      try {
        const data = await requestAdminJson(`/api/admin/venue-change-requests?page=${page}`, {
          cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to load club page change requests.",
        });
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.requests) || typeof data.total !== "number") throw new Error("Change requests could not be confirmed.");
        setRequests(data.requests); setTotal(data.total); setHasMore(data.hasMore === true); setError(""); onCountChange(data.total);
        if (page > 0 && !data.requests.length) setPage(0);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Unable to refresh change requests.");
          onCountChange(null);
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(ADMIN_DATA_CHANGED, load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", load); window.removeEventListener(ADMIN_DATA_CHANGED, load); };
  }, [page, revision, onCountChange]);

  if (!visible) return null;
  return <section id="admin-club-page-changes" tabIndex={-1} className={styles.queue} aria-label="Club page change requests" aria-busy={loading}>
    <header><h2>Club page change requests {total !== null && <span>{total}</span>}</h2>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh requests</button></header>
    {error && <p role="alert">{error} {total !== null ? "Showing the last confirmed requests." : ""}</p>}
    {total === null && loading ? <p role="status">Checking club requests…</p> : total === 0 && !error ? <p>No club page changes are waiting for review.</p> : null}
    <AdminInboxActions items={requests.map(request => ({ kind: "page_change", id: request.id, version: request.page_reviewed_at || request.updated_at, title: request.name }))} onComplete={archived => {
      setRequests(current => current.filter(request => !archived.some(item => item.id === request.id))); setRevision(value => value + 1);
    }} />
    {requests.map(request => <article key={request.id}>
      <div><strong>{request.name}</strong><small>{[request.city, request.state].filter(Boolean).join(", ")}{request.page_reviewed_at ? ` · ${new Date(request.page_reviewed_at).toLocaleString()}` : ""}</small></div>
      <p>{request.page_review_notes || "The club requested changes. Open its page to review."}</p>
      <button type="button" onClick={() => onOpen(request)}>Review changes</button>
    </article>)}
    {(page > 0 || hasMore) && <footer><button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
      <span>Page {page + 1}</span><button type="button" disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>Next</button></footer>}
  </section>;
}
