"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string };

export function PasswordField({ label, id, disabled, ...props }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [visible, setVisible] = useState(false);

  return <div className="dancr-password-field">
    <label htmlFor={inputId}>{label}</label>
    <span className="dancr-password-input">
      <input {...props} id={inputId} type={visible ? "text" : "password"} disabled={disabled} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="dancr-password-toggle" disabled={disabled}
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={inputId}
        onClick={() => setVisible(value => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="m3 3 18 18" /> : null}
        </svg>
      </button>
    </span>
    <style>{`
      .dancr-password-field { display: grid; gap: 8px; min-width: 0; }
      .dancr-password-input { position: relative; display: block; min-width: 0; }
      .dancr-password-field .dancr-password-input > input { box-sizing: border-box; width: 100%; min-width: 0; padding-right: 56px !important; }
      .dancr-password-field button.dancr-password-toggle { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: grid !important; place-items: center; width: 44px !important; min-width: 44px !important; max-width: 44px !important; height: 44px !important; min-height: 44px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; background: transparent !important; box-shadow: none !important; color: #c6a5fb !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; cursor: pointer; }
      .dancr-password-toggle svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dancr-password-toggle:focus-visible { outline: 2px solid #c4a0ff; outline-offset: -2px; }
      .dancr-password-toggle:disabled { opacity: .65; cursor: default; }
    `}</style>
  </div>;
}
