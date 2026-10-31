"use client";
import { useRef, useState } from "react";
import { STAFF_WORKSPACES, type StaffRole } from "@/src/lib/dancr/admin-workspace-policy";
import type { StaffAccount } from "@/src/lib/dancr/admin-staff";
import { requestAdminJson } from "./admin-session";
import styles from "./AdminStaffSetup.module.css";

const roleLabels: Record<string, string> = { owner: "Owner — full access", reviewer: "Content reviewer", compliance: "Safety & privacy", support: "Support", billing: "Billing" };

export function AdminStaffCreate({ onAdded, onSaved }: { onAdded: (staff: StaffAccount) => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("reviewer");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function add() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestAdminJson("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", displayName: name, email, role }) });
      onAdded(result.staff); setName(""); setEmail(""); setRole("reviewer");
      if (result.deliveryWarning) setError(result.deliveryWarning);
      else { setMessage(result.message); onSaved(result.message); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add staff."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div>
    <form className={styles.form} aria-label="Add staff" onSubmit={event => { event.preventDefault(); void add(); }}>
      <h3>Add staff</h3><p>Use a separate staff email. We’ll email a link so they can set their own password and sign in to the admin dashboard.</p>
      <label htmlFor="admin-staff-name">Name<input id="admin-staff-name" autoComplete="off" maxLength={100} required disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
      <label htmlFor="admin-staff-email">Email<input id="admin-staff-email" type="email" autoComplete="off" maxLength={254} required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label htmlFor="admin-staff-role">Staff role<select id="admin-staff-role" disabled={busy} value={role} onChange={event => setRole(event.target.value as StaffRole)}>
        {Object.keys(STAFF_WORKSPACES).map(value => <option value={value} key={value}>{roleLabels[value] || value}</option>)}
      </select></label>
      <button type="submit" disabled={busy || !name.trim() || !email.trim()}>{busy ? "Adding staff…" : "Add staff & send email"}</button>
    </form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}

export function AdminStaffSetupEmail({ id, onSaved }: { id: string; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  async function send() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await requestAdminJson("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resend", id }) });
      onSaved(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send setup email."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <span><button type="button" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Send setup email"}</button>{error && <span role="alert">{error}</span>}</span>;
}
