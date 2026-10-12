"use client";

import { useEffect, useState } from "react";
import { createAdmissionPassImage, saveAdmissionPassImage, type AdmissionPassImage } from "@/src/lib/dancr/admission-pass-image";

export default function AdmissionPassSaveButton({ qrImage, venueName, title, arrivalLabel, expiresAt, timezone, offerHours }: AdmissionPassImage) {
  const [image, setImage] = useState<{ source: string; file: File } | null>(null);
  const [message, setMessage] = useState("");
  const source = JSON.stringify([qrImage, venueName, title, arrivalLabel, expiresAt, timezone, offerHours]);
  const file = image?.source === source ? image.file : null;

  useEffect(() => {
    let active = true;
    void createAdmissionPassImage({ qrImage, venueName, title, arrivalLabel, expiresAt, timezone, offerHours }).then(file => {
      if (active) setImage({ source, file });
    }).catch(() => {
      if (active) setMessage("Image saving is unavailable. You can take a screenshot of your QR instead.");
    });
    return () => { active = false; };
  }, [source, qrImage, venueName, title, arrivalLabel, expiresAt, timezone, offerHours]);

  function save() {
    if (!file) return;
    if (Date.parse(expiresAt) <= Date.now()) {
      setMessage("This pass has expired. Open My QR passes to choose an active pass.");
      return;
    }
    setMessage("");
    try {
      saveAdmissionPassImage(file);
      setMessage("Download started. Keep your pass image for the door.");
    } catch {
      setMessage("Unable to save the image. Try again or take a screenshot of your QR.");
    }
  }

  return <>
    <button type="button" className="deal-pass-continue is-secondary" disabled={!file} onClick={save}>
      Save to phone
    </button>
    {message ? <small role="status">{message}</small> : null}
  </>;
}
