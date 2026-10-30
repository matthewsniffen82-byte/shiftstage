"use client";
import { useEffect, useRef } from "react";
import RequestTermsCheckbox from "../components/RequestTermsCheckbox";
import { TABLE_REQUEST_NOTICE } from "@/src/lib/dancr/access-terms";
import { newRequestTermsAcceptance, type RequestTermsAcceptance } from "@/src/lib/dancr/request-terms";

export default function TableRequestConsent({ cancel, onAccept, onClose }: { cancel: boolean; onAccept: (terms: RequestTermsAcceptance) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialog} className="ir-consent-dialog" aria-labelledby="table-consent-title" onCancel={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (new FormData(event.currentTarget).get("userTermsAccepted") === "on") onAccept(newRequestTermsAcceptance(true)); }}>
      <h2 id="table-consent-title">{cancel ? "Cancel this table request" : "Send a table request"}</h2>
      <p>{TABLE_REQUEST_NOTICE}</p>
      <RequestTermsCheckbox table />
      <div className="ir-consent-actions"><button type="button" onClick={onClose}>Go back</button><button type="submit">{cancel ? "Confirm cancellation" : "Send request"}</button></div>
    </form>
  </dialog>;
}
