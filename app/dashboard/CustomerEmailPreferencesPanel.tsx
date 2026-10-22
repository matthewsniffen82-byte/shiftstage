"use client";

import { useEffect, useRef, useState } from "react";
import { customerNotificationSettings, CUSTOMER_EMAIL_CONSENT_TEXT, CUSTOMER_EMAIL_CONSENT_VERSION } from "@/src/lib/dancr/customer-notification-preferences";
import type { CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { readSession, requestCustomerProfileJson } from "./dashboard-session";

export default function CustomerEmailPreferencesPanel({ profile, onProfileChange }: {
  profile: Record<string, unknown>;
  onProfileChange: (profile: Record<string, unknown>) => void;
}) {
  const userId = String(profile.userId || "");
  const savedEmailEnabled = customerNotificationSettings(profile.notificationSettings).emailEnabled;
  const delivery = (profile.notificationDelivery || {}) as CustomerNotificationDelivery;
  const [emailEnabled, setEmailEnabled] = useState(savedEmailEnabled);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusy(false);
    setFeedback(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [userId]);

  useEffect(() => {
    setEmailEnabled(savedEmailEnabled);
  }, [userId, savedEmailEnabled]);

  async function changeEmailSubscription() {
    if (pending.current || (!emailEnabled && !delivery.emailAvailable)) return;
    const session = readSession();
    if (!userId || !session?.accessToken || session.account?.role !== "customer" || session.account.id !== userId) {
      setFeedback({ error: true, message: "Sign in again before changing your email preference." });
      return;
    }
    const nextEnabled = !emailEnabled;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFeedback(null);
    const isCurrent = () => pending.current === controller && !controller.signal.aborted && readSession()?.account?.id === userId;
    try {
      const data = await requestCustomerProfileJson({
        method: "PATCH", timeoutMs: 20_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationSettings: { emailEnabled: nextEnabled }, emailConsentSource: "account_preferences", emailConsentVersion: CUSTOMER_EMAIL_CONSENT_VERSION }),
        fallbackMessage: "Unable to save your email preference. Please try again.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (data.profile?.userId !== userId || data.profile?.notificationSettings?.emailEnabled !== nextEnabled) {
        throw new Error("Your email preference was not confirmed. Please try again.");
      }
      setEmailEnabled(nextEnabled);
      onProfileChange(data.profile);
      setFeedback({ error: false, message: nextEnabled
        ? "You’re subscribed to MyDancr emails. You can unsubscribe at any time."
        : "You’re unsubscribed from optional MyDancr emails." });
    } catch (error) {
      if (isCurrent()) setFeedback({ error: true, message: error instanceof Error ? error.message : "Unable to save your email preference. Please try again." });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <article className="info-panel customer-account-details customer-email-preferences" aria-labelledby="customer-email-heading">
      <h2 id="customer-email-heading">Email communications</h2>
      <p id="customer-email-description">{CUSTOMER_EMAIL_CONSENT_TEXT}</p>
      {!emailEnabled && <p>Optional emails stay off until you choose “Subscribe to emails”. Creating an account or following a dancer does not automatically subscribe you.</p>}
      <p className="customer-email-state">Optional emails are <strong>{emailEnabled ? "on" : "off"}</strong>.</p>
      <button className="account-action-button" type="button" disabled={busy || (!emailEnabled && !delivery.emailAvailable)} aria-busy={busy || undefined} aria-describedby="customer-email-description" onClick={changeEmailSubscription}>
        {busy ? emailEnabled ? "Unsubscribing…" : "Subscribing…" : emailEnabled ? "Unsubscribe from emails" : "Subscribe to emails"}
      </button>
      {!emailEnabled && !delivery.emailAvailable ? <p>Email subscriptions are temporarily unavailable. Please try again later.</p> : null}
      <p>Password resets and essential account emails will still be sent. Your in-app alerts and push preferences stay the same.</p>
      {feedback ? <p className="customer-email-feedback" data-error={feedback.error || undefined} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}
      <style jsx>{`
        .customer-email-preferences { display: grid; gap: 12px; min-width: 0; }
        .customer-email-preferences h2, .customer-email-preferences p { margin: 0; }
        .customer-email-preferences p { color: var(--customer-muted); font-size: 13px; line-height: 1.6; }
        .customer-email-preferences .customer-email-state, .customer-email-preferences .customer-email-feedback { color: inherit; }
        .customer-email-preferences .customer-email-feedback[data-error] { color: var(--customer-danger); }
        .customer-email-preferences button { justify-self: start; max-width: 100%; }
        .customer-email-preferences button:focus-visible { outline: 2px solid var(--customer-selected-line); outline-offset: 3px; }
        .customer-email-preferences button:disabled { cursor: not-allowed; opacity: .65; }
      `}</style>
    </article>
  );
}
