"use client";

export default function DancerMediaPinButton({ label, pinned = false, busy = false, disabled, onClick }: {
  label: string;
  pinned?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <>
    <button className="dancer-media-pin" aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
      aria-pressed={pinned} aria-busy={busy} title={pinned ? "Unpin" : "Pin to top"}
      disabled={disabled || busy} onClick={onClick} type="button">
      <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m15 3 6 6-3 1-4 4v4l-2 2-3-5-5-3 2-2h4l4-4 1-3Z" /><path d="m9 15-6 6" /></svg></span>
    </button>
    <style>{`
      button.dancer-media-pin, body.dancr-button-system button.dancer-media-pin { position:absolute; top:2px; right:2px; bottom:auto; z-index:2; display:grid; place-items:center; width:44px !important; height:44px !important; min-height:44px !important; min-width:44px; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; color:#fff !important; cursor:pointer; }
      button.dancer-media-pin > span { width:30px; height:30px; display:grid; place-items:center; justify-self:end; border:1px solid rgba(255,255,255,.5); border-radius:50%; background:rgba(0,0,0,.78); box-shadow:0 1px 5px rgba(0,0,0,.35); }
      button.dancer-media-pin[aria-pressed="true"] > span { background:#6d28d9; border-color:#d3bbff; }
      button.dancer-media-pin svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      button.dancer-media-pin[aria-pressed="true"] svg { fill:rgba(255,255,255,.25); }
      button.dancer-media-pin:disabled { opacity:.55; cursor:wait; }
      button.dancer-media-pin:focus-visible { outline:2px solid #fff; outline-offset:-2px; }
    `}</style>
  </>;
}
