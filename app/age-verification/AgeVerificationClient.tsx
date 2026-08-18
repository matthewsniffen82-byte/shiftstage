"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./age-verification.module.css";

type GateState = "idle" | "starting" | "processing" | "cancelled" | "failed" | "error";

export function AgeVerificationClient({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const [state, setState] = useState<GateState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const initialState = parameters.get("state");
    if (["processing", "cancelled", "failed", "error"].includes(initialState || "")) {
      setState(initialState as GateState);
    }
    const sessionId = parameters.get("sessionId");
    if (initialState !== "processing" || !sessionId) return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const checkResult = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/age-verification/result?sessionId=${encodeURIComponent(sessionId)}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const result = await response.json() as { state?: string; error?: string };
        if (cancelled) return;
        if (response.ok && result.state === "passed") {
          window.location.replace(safeBrowserReturnTo(parameters.get("returnTo")));
          return;
        }
        if (result.state === "failed" || result.state === "cancelled" || result.state === "error") {
          setState(result.state);
          setMessage(result.error || "Yoti could not confirm that you meet the age requirement.");
          return;
        }
      } catch {
        if (!cancelled) setMessage("Still waiting for Yoti to finish the check.");
      }
      if (!cancelled && attempts < 12) timer = window.setTimeout(checkResult, 2_000);
      else if (!cancelled) {
        setState("error");
        setMessage("The result is taking longer than expected. Please start a new verification.");
      }
    };
    void checkResult();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const startVerification = async () => {
    setState("starting");
    setMessage("");
    try {
      const parameters = new URLSearchParams(window.location.search);
      const response = await fetch("/api/age-verification/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: safeBrowserReturnTo(parameters.get("returnTo")) }),
      });
      const result = await response.json() as { sessionUrl?: string; error?: string };
      if (!response.ok || !result.sessionUrl) throw new Error(result.error || "Could not start verification.");
      window.location.assign(result.sessionUrl);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not start verification.");
    }
  };

  const unavailable = enabled && !configured;
  const statusMessage = unavailable ? "" : message || defaultStatusMessage(state);

  return (
    <main className={`${styles.page} age-verification-page`}>
      <section className={styles.card} aria-labelledby="age-verification-title">
        <div className={styles.brand}>mydancr</div>
        <div className={styles.yotiMark} aria-hidden="true">18+</div>
        <p className={styles.eyebrow}>AGE-RESTRICTED EXPERIENCE</p>
        <h1 id="age-verification-title">Verify you are 18 or older</h1>
        <p className={styles.intro}>
          A quick age check is required before entering MyDancr. Yoti handles the check securely and returns only the result.
        </p>

        <div className={styles.privacy}>
          <strong>Your privacy is built in</strong>
          <span>MyDancr does not receive or store your birth date, exact age, ID image, or selfie.</span>
        </div>

        {statusMessage ? (
          <p className={`${styles.status} ${state === "processing" || state === "starting" ? styles.pending : styles.problem}`} role="status">
            {statusMessage}
          </p>
        ) : null}

        {!enabled ? (
          <Link className={styles.primary} href="/">Continue to MyDancr</Link>
        ) : (
          <button
            className={styles.primary}
            disabled={unavailable || state === "starting" || state === "processing"}
            onClick={startVerification}
            type="button"
          >
            {state === "starting" ? "Opening Yoti…" : state === "processing" ? "Checking result…" : "Verify my age with Yoti"}
          </button>
        )}

        {unavailable ? (
          <p className={styles.configurationError} role="alert">
            Age verification is temporarily unavailable. Please try again later.
          </p>
        ) : null}

        {enabled && state !== "processing" ? (
          <button
            className={styles.exit}
            onClick={() => window.location.replace("https://www.google.com")}
            type="button"
          >
            I am under 18 — exit
          </button>
        ) : null}

        <p className={styles.legal}>
          By continuing, you agree to Yoti processing the information needed to perform this age check under its{" "}
          <a href="https://www.yoti.com/privacy/age-verification/" rel="noreferrer" target="_blank">
            Age Verification Privacy Notice
          </a>.
        </p>
      </section>
    </main>
  );
}

function defaultStatusMessage(state: GateState) {
  if (state === "processing") return "Yoti is finishing your age check. Keep this page open.";
  if (state === "cancelled") return "The age check was cancelled. You can try again when ready.";
  if (state === "failed") return "Yoti could not confirm that you are 18 or older.";
  if (state === "error") return "Age verification could not be completed. Please try again.";
  return "";
}

function safeBrowserReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith("/age-verification")) {
    return "/";
  }
  return value;
}
