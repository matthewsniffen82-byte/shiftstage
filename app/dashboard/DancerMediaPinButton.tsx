"use client";

export default function DancerMediaPinButton({ label, pinned = false, busy = false, disabled, available = true, onClick, placement = "right" }: {
  label: string;
  pinned?: boolean;
  busy?: boolean;
  disabled?: boolean;
  available?: boolean;
  onClick: () => void;
  placement?: "right" | "left" | "inline";
}) {
  const action = `${pinned ? "Unpin" : "Pin"} ${label}`;
  return <button
    className={`dancer-media-pin is-${placement}`}
    type="button"
    aria-label={action}
    aria-pressed={pinned}
    aria-busy={busy}
    data-pinned={pinned}
    title={available ? action : `${action} — available after approval`}
    disabled={disabled || busy || !available}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      if (!disabled && !busy && available) onClick();
    }}
  >
    <span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path className="dancer-media-pin-head" d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg></span>
  </button>;
}
