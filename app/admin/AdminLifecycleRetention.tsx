"use client";
import { useEffect, useState } from "react";
import { requestAdminJson } from "./admin-session";

type Data = {
  preview: { asOf: string; sources: { source: string; due: number; blocker: string | null }[];
    media: { state: string; count: number }[]; latestExport: { created_at: string; through_sequence: number } | null;
    unmappedClocks: Record<string, number> };
  runs: { id: string; source: string; started_at: string; status: string; removed: number; reason: string | null; error_code: string | null }[];
};

export default function AdminLifecycleRetention() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    requestAdminJson("/api/admin/lifecycle-retention", { cache: "no-store" }).then(result => { if (current) { setData(result as Data); setError(""); } })
      .catch(() => { if (current) setError("Unable to load scheduled deletion. Refresh to retry."); });
    return () => { current = false; };
  }, [refresh]);
  return <section className="admin-compliance-card">
    <h3>Scheduled deletion and recovery</h3>
    <p>Hourly cleanup uses original event, closure and removal dates. Active preservation holds pause this worker. Missing historical dates require review.</p>
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh deletion status</button>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>Last recovery export: {data.preview.latestExport ? new Date(data.preview.latestExport.created_at).toLocaleString() : "Not confirmed"}.</p>
      <p>Recovery exports contain restricted record references, not deleted content. Before any restoration, save a fresh export outside the project. Reapply deletions in an isolated restored project before allowing ordinary use.</p>
      <p>These receipts confirm application work only. Provider erasure, backup expiry, legal preservation, financial records and outside copies require their separate evidence.</p>
      <ul>{data.preview.media.map(row => <li key={row.state}>Media {row.state}: {row.count}</li>)}</ul>
      {Object.values(data.preview.unmappedClocks).some(n => n > 0) && <p role="alert">Some records lack a reliable original closure or removal date. Review the data inventory before assigning a deadline.</p>}
      <details><summary>Deletion sources and due records</summary>
        <table><thead><tr><th>Source</th><th>Due</th><th>Status</th></tr></thead><tbody>
          {data.preview.sources.map(row => <tr key={row.source}><td>{row.source}</td><td>{row.due}</td><td>{row.blocker ? row.blocker.replaceAll("_", " ") : "Scheduled"}</td></tr>)}
        </tbody></table>
      </details>
      <details><summary>Recent deletion receipts</summary>
        {data.runs.map(row => <p key={row.id}>{new Date(row.started_at).toLocaleString()} · {row.source} · {row.status} · {row.removed} removed{row.reason ? ` · ${row.reason.replaceAll("_", " ")}` : ""}{row.error_code ? ` · Error ${row.error_code}; retry scheduled` : ""}</p>)}
      </details>
    </>}
  </section>;
}
