"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { requestAdminJson } from "./admin-session";

type Agent = {
  legalName?: string;
  organization?: string | null;
  email?: string;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  postalCode?: string | null;
  country?: string | null;
  registeredWithCopyrightOffice?: boolean;
  registrationRenewalAt?: string | null;
};

type DmcaCase = {
  id: string;
  claimantName?: string;
  claimantCompany?: string | null;
  claimantEmail?: string;
  claimantPhone?: string;
  claimantAddress?: string;
  copyrightedWorkDescription?: string;
  originalWorkUrl?: string | null;
  infringingUrl?: string;
  targetType?: string;
  targetId?: string | null;
  uploaderId?: string | null;
  status?: string;
  disabledAt?: string | null;
  counterReceivedAt?: string | null;
  restoreEligibleAt?: string | null;
  restoreDeadlineAt?: string | null;
  courtFilingReceived?: boolean;
  repeatInfringerEnforced?: boolean;
  counterNotices?: Array<Record<string, unknown>>;
  strikes?: Array<Record<string, unknown>>;
};

type AdminAction =
  | "request_information"
  | "reject"
  | "disable"
  | "record_court_action"
  | "restore"
  | "close";

export default function AdminDmcaPanel() {
  const [cases, setCases] = useState<DmcaCase[]>([]);
  const [agent, setAgent] = useState<Agent>({});
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState("");
  const [agentFormVersion, setAgentFormVersion] = useState(0);
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      actionSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      actionAbortRef.current?.abort();
      actionInFlightRef.current = false;
    };
  }, []);

  async function load({ refreshAgent = true, clearStatus = true } = {}) {
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (mountedRef.current) setIsLoading(true);
    try {
      const data = await requestAdminJson("/api/admin/dmca", {
        signal: controller.signal,
        fallbackMessage: "Unable to load copyright operations.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setCases(data.cases || []);
      if (refreshAgent) {
        setAgent(data.agent || {});
        setAgentFormVersion((current) => current + 1);
      }
      if (clearStatus) setStatus("");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to load copyright operations.");
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (mountedRef.current && requestId === loadSequenceRef.current) setIsLoading(false);
    }
  }

  async function takeAction(dmcaCase: DmcaCase, action: AdminAction) {
    if (!mountedRef.current || actionInFlightRef.current) return;
    const notes = notesById[dmcaCase.id]?.trim() || "";
    if ((action === "record_court_action" || action === "request_information" || action === "reject") && !notes) {
      setStatus("Add case notes before taking that action.");
      return;
    }

    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setWorkingId(dmcaCase.id);
    setStatus("");
    try {
      const data = await requestAdminJson("/api/admin/dmca", {
        method: "PATCH",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ caseId: dmcaCase.id, action, notes }),
        fallbackMessage: "Unable to update copyright case.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setStatus(data.message || "Copyright case updated.");
      setNotesById((current) => ({ ...current, [dmcaCase.id]: "" }));
      await load({ refreshAgent: false, clearStatus: false });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to update copyright case.");
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (requestId === actionSequenceRef.current) actionInFlightRef.current = false;
      if (mountedRef.current && requestId === actionSequenceRef.current) setWorkingId("");
    }
  }

  async function saveAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mountedRef.current || actionInFlightRef.current) return;
    const values = new FormData(event.currentTarget);
    const payload = {
      resource: "agent",
      legalName: values.get("legalName"),
      organization: values.get("organization"),
      email: values.get("email"),
      phone: values.get("phone"),
      addressLine1: values.get("addressLine1"),
      addressLine2: values.get("addressLine2"),
      city: values.get("city"),
      stateRegion: values.get("stateRegion"),
      postalCode: values.get("postalCode"),
      country: values.get("country"),
      registeredWithCopyrightOffice: values.get("registeredWithCopyrightOffice") === "on",
      registrationRenewalAt: values.get("registrationRenewalAt"),
    };

    actionInFlightRef.current = true;
    const requestId = actionSequenceRef.current + 1;
    actionSequenceRef.current = requestId;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setWorkingId("agent");
    setStatus("");
    try {
      const data = await requestAdminJson("/api/admin/dmca", {
        method: "PATCH",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        fallbackMessage: "Unable to save copyright agent.",
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setAgent(data.agent);
      setAgentFormVersion((current) => current + 1);
      setStatus(data.message || "Copyright agent details saved.");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== actionSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to save copyright agent.");
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (requestId === actionSequenceRef.current) actionInFlightRef.current = false;
      if (mountedRef.current && requestId === actionSequenceRef.current) setWorkingId("");
    }
  }

  return (
    <div className="dmca-admin">
      <div className="dmca-admin-summary">
        <strong>{cases.length} active cases</strong>
        <a href="/dmca" target="_blank" rel="noreferrer">Open public copyright page</a>
      </div>
      {!agent.registeredWithCopyrightOffice ? (
        <p className="dmca-agent-warning">
          Copyright Office registration is not confirmed. Complete the government filing, then save the registered
          agent details and renewal date below.
        </p>
      ) : null}

      <details className="dmca-agent-settings">
        <summary>Copyright agent settings</summary>
        <form key={agentFormVersion} onSubmit={saveAgent}>
          <label>Agent legal name<input name="legalName" defaultValue={agent.legalName || ""} required /></label>
          <label>Organization<input name="organization" defaultValue={agent.organization || ""} /></label>
          <label>Email<input name="email" type="email" defaultValue={agent.email || ""} required /></label>
          <label>Phone<input name="phone" type="tel" defaultValue={agent.phone || ""} /></label>
          <label>Address line 1<input name="addressLine1" defaultValue={agent.addressLine1 || ""} /></label>
          <label>Address line 2<input name="addressLine2" defaultValue={agent.addressLine2 || ""} /></label>
          <label>City<input name="city" defaultValue={agent.city || ""} /></label>
          <label>State or region<input name="stateRegion" defaultValue={agent.stateRegion || ""} /></label>
          <label>Postal code<input name="postalCode" defaultValue={agent.postalCode || ""} /></label>
          <label>Country<input name="country" defaultValue={agent.country || ""} /></label>
          <label>Registration renewal date<input name="registrationRenewalAt" type="date" defaultValue={agent.registrationRenewalAt || ""} /></label>
          <label className="dmca-agent-check">
            <input name="registeredWithCopyrightOffice" type="checkbox" defaultChecked={agent.registeredWithCopyrightOffice === true} />
            Registered with the U.S. Copyright Office
          </label>
          <button type="submit" disabled={Boolean(workingId)}>
            {workingId === "agent" ? "Saving…" : "Save copyright agent"}
          </button>
        </form>
      </details>

      {status ? <p className="dmca-admin-status" role="status" aria-live="polite">{status}</p> : null}
      {isLoading ? <p>Loading copyright cases…</p> : null}
      {!isLoading && !cases.length ? <p className="empty">No active copyright cases.</p> : null}

      <div className="dmca-case-list">
        {cases.map((dmcaCase) => {
          const actionBusy = Boolean(workingId);
          const eligibleAt = dmcaCase.restoreEligibleAt ? new Date(dmcaCase.restoreEligibleAt) : null;
          const restorationEligible = Boolean(eligibleAt && eligibleAt.getTime() <= Date.now());
          const activeStrikes = (dmcaCase.strikes || []).filter((strike) => strike.active === true).length;
          return (
            <details className="dmca-case-row" key={dmcaCase.id}>
              <summary>
                <span>
                  <strong>{label(dmcaCase.status || "submitted")} · {dmcaCase.claimantName || "Claimant"}</strong>
                  <small>{dmcaCase.id}</small>
                </span>
                <em>{dmcaCase.targetType === "tv_video" ? "Video identified" : "Manual identification needed"}</em>
              </summary>
              <div className="dmca-case-detail">
                <strong>Claimant contact</strong>
                <p>{dmcaCase.claimantEmail} · {dmcaCase.claimantPhone}</p>
                <p>{dmcaCase.claimantAddress}</p>
                <strong>Claimed work</strong>
                <p>{dmcaCase.copyrightedWorkDescription}</p>
                {dmcaCase.originalWorkUrl ? <a href={dmcaCase.originalWorkUrl} target="_blank" rel="noreferrer">Open original work reference</a> : null}
                {dmcaCase.infringingUrl ? <a href={dmcaCase.infringingUrl} target="_blank" rel="noreferrer">Open reported MyDancr location</a> : null}
                <small>Uploader: {dmcaCase.uploaderId || "Not identified"} · Active strike on this case: {activeStrikes ? "Yes" : "No"}</small>
                {dmcaCase.repeatInfringerEnforced ? <p className="dmca-agent-warning">Repeat-infringer suspension was enforced.</p> : null}
                {dmcaCase.counterNotices?.length ? (
                  <div className="dmca-counter-summary">
                    <strong>Counter-notice received</strong>
                    <p>
                      Restoration eligible: {eligibleAt ? eligibleAt.toLocaleString() : "Pending"}
                      {dmcaCase.restoreDeadlineAt ? ` · deadline ${new Date(dmcaCase.restoreDeadlineAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                ) : null}
                <label>
                  Case notes
                  <textarea
                    value={notesById[dmcaCase.id] || ""}
                    onChange={(event) => setNotesById((current) => ({ ...current, [dmcaCase.id]: event.target.value }))}
                    maxLength={4000}
                  />
                </label>
                <div className="dmca-case-actions">
                  {dmcaCase.status === "submitted" || dmcaCase.status === "needs_information" ? (
                    <>
                      <button type="button" disabled={actionBusy} onClick={() => takeAction(dmcaCase, "request_information")}>Request information</button>
                      <button type="button" disabled={actionBusy} onClick={() => takeAction(dmcaCase, "reject")}>Reject notice</button>
                      <button
                        className="danger-action"
                        type="button"
                        disabled={actionBusy || dmcaCase.targetType !== "tv_video"}
                        onClick={() => takeAction(dmcaCase, "disable")}
                      >
                        Disable reported video
                      </button>
                    </>
                  ) : null}
                  {dmcaCase.status === "countered" ? (
                    <>
                      <button type="button" disabled={actionBusy} onClick={() => takeAction(dmcaCase, "record_court_action")}>Record filed court action</button>
                      <button type="button" disabled={actionBusy || !restorationEligible} onClick={() => takeAction(dmcaCase, "restore")}>Restore after waiting period</button>
                    </>
                  ) : null}
                  {dmcaCase.status === "court_hold" ? (
                    <button type="button" disabled={actionBusy} onClick={() => takeAction(dmcaCase, "close")}>Close court-held case</button>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
