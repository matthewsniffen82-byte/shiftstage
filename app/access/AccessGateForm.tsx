"use client";

import { FormEvent, useState } from "react";

export function AccessGateForm({ returnTo }: { returnTo: string }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setMessage("Checking access…");

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code, returnTo }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok || !data.ok) {
        setMessage(data.error || "Access could not be verified.");
        setIsSubmitting(false);
        return;
      }

      setMessage("Access granted. Opening mydancr…");
      window.location.replace(data.redirectTo || "/");
    } catch {
      setMessage("Access could not be verified. Check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="site-access-form" onSubmit={submit}>
      <label htmlFor="siteAccessCode">Access code</label>
      <input
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        id="siteAccessCode"
        maxLength={256}
        name="accessCode"
        onChange={(event) => {
          setCode(event.target.value);
          if (message) setMessage("");
        }}
        required
        spellCheck={false}
        type="password"
        value={code}
      />
      <button disabled={isSubmitting || !code.trim()} type="submit">
        {isSubmitting ? "Checking…" : "Enter mydancr"}
      </button>
      <p aria-live="polite" className="site-access-status" role="status">
        {message}
      </p>
    </form>
  );
}
