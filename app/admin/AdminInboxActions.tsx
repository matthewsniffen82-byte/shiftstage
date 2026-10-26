"use client";

import { useEffect, useRef, useState } from "react";
import type { InboxArchiveItem } from "@/src/lib/dancr/admin-inbox-archive";
import { requestAdminJson } from "./admin-session";
import { ADMIN_INBOX_ARCHIVE_CHANGED } from "./admin-data-events";
import styles from "./admin-inbox-archive.module.css";

export type SelectableInboxItem = InboxArchiveItem & { title: string };

/** Selection is a snapshot: a newer reply must be read before it can be archived. */
export default function AdminInboxActions({ items, action = "archive", disabled = false, onComplete, onStart, onSettled }: {
  items: SelectableInboxItem[]; action?: "archive" | "restore"; disabled?: boolean;
  onComplete: (items: InboxArchiveItem[]) => void; onStart?: () => void; onSettled?: () => void;
}) {
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState<SelectableInboxItem[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const available = selected.filter(item => items.some(current => current.kind === item.kind && current.id === item.id));
  const label = action === "archive" ? "Archive" : "Restore";
  async function submit() {
    if (disabled || controller.current || !available.length) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); onStart?.();
    try {
      await requestAdminJson("/api/admin/inbox-archive", {
        method: "POST", signal: request.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, items: available.map(({ kind, id, version }) => ({ kind, id, version })) }),
        fallbackMessage: `Unable to ${action} the selected items.`,
      });
      if (request.signal.aborted) return;
      onComplete(available);
      window.dispatchEvent(new CustomEvent(ADMIN_INBOX_ARCHIVE_CHANGED, { detail: { action, items: available } }));
      setSelected([]); setExpanded(false);
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to update the inbox.");
    } finally {
      if (controller.current === request) controller.current = null;
      if (!request.signal.aborted) { setBusy(false); onSettled?.(); }
    }
  }
  if (!items.length) return null;
  return <div className={styles.actions}>
    <button type="button" disabled={busy || disabled} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setSelected([]); setError(""); }}>{expanded ? "Cancel selection" : `${label} items…`}</button>
    {expanded && <div className={styles.selection}>
      <p>{action === "archive" ? "Move selected items out of the active inbox. You can restore them from Archived." : "Restore selected items. Their approval and reply statuses stay the same."}</p>
      <button type="button" disabled={busy || disabled} onClick={() => setSelected(items.slice(0, 100))}>Select shown{items.length > 100 ? " (first 100)" : ""}</button>
      {items.map(item => { const checked = available.some(value => value.kind === item.kind && value.id === item.id); return <label key={`${item.kind}:${item.id}`}>
        <input type="checkbox" checked={checked} disabled={busy || disabled || (!checked && available.length >= 100)} onChange={() => setSelected(current => checked ? current.filter(value => value.kind !== item.kind || value.id !== item.id) : [...current, item])} />
        <span>{item.title}</span>
      </label>; })}
      <button type="button" disabled={busy || disabled || !available.length} onClick={() => void submit()}>{busy ? "Saving…" : `${label} selected (${available.length})`}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
