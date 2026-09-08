"use client";

import { useEffect, useRef, useState } from "react";

export default function DancerMediaViewer({ kind, label, imageUrl, videoUrl, onClose }: {
  kind: "photo" | "video";
  label: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const available = Boolean(kind === "photo" ? imageUrl : videoUrl) && !failed;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return <dialog
    ref={dialogRef}
    className="dancer-media-viewer"
    aria-label={`${label} preview`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => event.stopPropagation()}
  >
    <header>
      <strong>{label}</strong>
      <button aria-label="Close media preview" onClick={onClose} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    {available ? kind === "photo"
      ? <img alt={label} src={imageUrl!} onError={() => setFailed(true)} />
      : <video autoPlay controls playsInline poster={imageUrl || undefined} src={videoUrl!} onError={() => setFailed(true)} />
      : <p role="status">Preview unavailable. Close and try again.</p>}
    <style>{`
      dialog.dancer-media-viewer { box-sizing:border-box; width:min(520px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); margin:auto; padding:12px; border:1px solid #645778; border-radius:18px; background:#100d18; color:#fff; }
      .dancer-media-viewer::backdrop { background:#000d; }
      .dancer-media-viewer > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .dancer-media-viewer > header > strong { font-size:16px; }
      html body.dancr-button-system .dancer-media-viewer > header > button { display:grid; place-items:center; width:44px !important; height:44px !important; min-width:44px !important; min-height:44px !important; padding:0 !important; border-radius:50% !important; }
      .dancer-media-viewer > header > button svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; }
      .dancer-media-viewer > img, .dancer-media-viewer > video { display:block; width:100%; max-height:calc(100dvh - 104px); object-fit:contain; border-radius:8px; background:#000; }
      .dancer-media-viewer > p { margin:12px 0; font-size:14px; line-height:1.5; }
    `}</style>
  </dialog>;
}
