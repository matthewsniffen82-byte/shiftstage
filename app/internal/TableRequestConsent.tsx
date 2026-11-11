"use client";
import { useEffect, useRef } from "react";
import RequestTermsCheckbox from "../components/RequestTermsCheckbox";
import { TABLE_REQUEST_NOTICE } from "@/src/lib/dancr/access-terms";
import { newRequestTermsAcceptance, type RequestTermsAcceptance } from "@/src/lib/dancr/request-terms";

type Props = { onClose: () => void } & (
  { onAccept: (terms: RequestTermsAcceptance) => void }
  | { dancerName: string; onConfirm: () => void }
);

export default function TableRequestConsent(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialog} className="ir-consent-dialog" aria-labelledby="table-consent-title" onCancel={props.onClose}>
    {"onConfirm" in props ? <div>
      <h2 id="table-consent-title">Cancel the request for {props.dancerName || "this dancer"}?</h2>
      <div className="ir-consent-actions"><button type="button" onClick={props.onClose}>Keep request</button><button type="button" onClick={props.onConfirm}>Confirm cancellation</button></div>
    </div> : <form onSubmit={event => { event.preventDefault(); if (new FormData(event.currentTarget).get("userTermsAccepted") === "on") props.onAccept(newRequestTermsAcceptance(true)); }}>
      <h2 id="table-consent-title">Send a table request</h2>
      <p>{TABLE_REQUEST_NOTICE}</p>
      <RequestTermsCheckbox table />
      <div className="ir-consent-actions"><button type="button" onClick={props.onClose}>Go back</button><button type="submit">Send request</button></div>
    </form>}
  </dialog>;
}
