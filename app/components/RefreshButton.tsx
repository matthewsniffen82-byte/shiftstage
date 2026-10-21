import type { ButtonHTMLAttributes } from "react";

type RefreshButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  busy?: boolean;
};

/** One refresh control for dashboards, rosters and supporting tools. */
export default function RefreshButton({ label, busy = false, disabled, className = "", children, ...props }: RefreshButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={`mydancr-refresh-button${children ? " has-label" : ""} ${className}`.trim()}
      aria-label={label}
      title={label}
      aria-busy={busy}
      disabled={disabled || busy}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.8L21 8" /><path d="M21 3v5h-5" />
      </svg>
      {children}
    </button>
  );
}
