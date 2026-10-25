"use client";

import { useEffect, useRef, useState } from "react";
import { customerNotificationSettings, CUSTOMER_EMAIL_CHOICES, CUSTOMER_EMAIL_CONSENT_VERSION, type CustomerEmailKey } from "@/src/lib/dancr/customer-notification-preferences";
import type { CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { readSession, requestCustomerProfileJson } from "./dashboard-session";

export default function CustomerEmailPreferencesPanel({ profile, onProfileChange }: {
  profile: Record<string, unknown>;
  onProfileChange: (profile: Record<string, unknown>) => void;
}) {
  const userId = String(profile.userId || "");
  const savedSettings = customerNotificationSettings(profile.notificationSettings);
  const delivery = (profile.notificationDelivery || {}) as CustomerNotificationDelivery;
  const [settings, setSettings] = useState(savedSettings);
  const [busy, setBusy] = useState<CustomerEmailKey | null>(null);
  const [feedback, setFeedback] = useState<{ error: true; message: string } | { error: false; key: CustomerEmailKey } | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusy(null);
    setFeedback(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [userId]);

  useEffect(() => {
    setSettings(customerNotificationSettings(profile.notificationSettings));
  }, [userId, profile.notificationSettings]);

  async function changeEmailSubscription(key: CustomerEmailKey) {
    if (pending.current || (!settings[key] && !delivery.emailAvailable)) return;
    const session = readSession();
    if (!userId || !session?.accessToken || session.account?.role !== "customer" || session.account.id !== userId) {
      setFeedback({ error: true, message: "Sign in again before changing your email preference." });
      return;
    }
    const nextEnabled = !settings[key];
    const controller = new AbortController();
    pending.current = controller;
    setBusy(key);
    setFeedback(null);
    const isCurrent = () => pending.current === controller && !controller.signal.aborted && readSession()?.account?.id === userId;
    try {
      const data = await requestCustomerProfileJson({
        method: "PATCH", timeoutMs: 20_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationSettings: { [key]: nextEnabled }, emailConsentSource: "account_preferences", emailConsentVersion: CUSTOMER_EMAIL_CONSENT_VERSION }),
        fallbackMessage: "Unable to save your email preference. Please try again.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (data.profile?.userId !== userId || data.profile?.notificationSettings?.[key] !== nextEnabled) {
        throw new Error("Your email preference was not confirmed. Please try again.");
      }
      setSettings(customerNotificationSettings(data.profile.notificationSettings));
      onProfileChange(data.profile);
      setFeedback({ error: false, key });
    } catch (error) {
      if (isCurrent()) setFeedback({ error: true, message: error instanceof Error ? error.message : "Unable to save your email preference. Please try again." });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <article className="info-panel customer-account-details customer-email-preferences" aria-labelledby="customer-email-heading">
      <h2 id="customer-email-heading">Email updates</h2>
      {CUSTOMER_EMAIL_CHOICES.map(choice => <section className="customer-email-choice" key={choice.key} aria-label={choice.title}>
        <h3>{choice.title}</h3>
        <p id={`customer-email-${choice.key}`}>{choice.text}</p>
        <p className="customer-email-state" role={feedback?.error === false && feedback.key === choice.key ? "status" : undefined}>{settings[choice.key] ? "Subscribed" : "Not subscribed"}</p>
        <button className="account-action-button" type="button" data-email-choice={choice.key} disabled={Boolean(busy) || (!settings[choice.key] && !delivery.emailAvailable)} aria-busy={busy === choice.key || undefined} aria-describedby={`customer-email-${choice.key}`} onClick={() => changeEmailSubscription(choice.key)}>
          {busy === choice.key ? settings[choice.key] ? "Unsubscribing…" : "Subscribing…" : settings[choice.key] ? "Unsubscribe" : "Subscribe"}
        </button>
      </section>)}
      {!delivery.emailAvailable ? <p>Email subscriptions are temporarily unavailable. Please try again later.</p> : null}
      <p>Essential account emails still arrive. Following adds updates to Alerts. Push is managed separately.</p>
      {feedback?.error ? <p className="customer-email-feedback" data-error role="alert">{feedback.message}</p> : null}
      <style jsx>{`
        .customer-email-preferences { display: grid; gap: 12px; min-width: 0; }
        .customer-email-choice { display: grid; gap: 8px; padding: 12px 0; border-top: 1px solid var(--customer-line); }
        .customer-email-choice h3 { margin: 0; font-size: 15px; }
        .customer-email-preferences h2, .customer-email-preferences p { margin: 0; }
        .customer-email-preferences p { color: var(--customer-muted); font-size: 13px; line-height: 1.6; }
        .customer-email-preferences .customer-email-state, .customer-email-preferences .customer-email-feedback { color: inherit; }
        .customer-email-preferences .customer-email-state { font-weight: 600; }
        .customer-email-preferences .customer-email-feedback[data-error] { color: var(--customer-danger); }
        .customer-email-preferences button { justify-self: start; max-width: 100%; }
        .customer-email-preferences button:focus-visible { outline: 2px solid var(--customer-selected-line); outline-offset: 3px; }
        .customer-email-preferences button:disabled { cursor: not-allowed; opacity: .65; }
      `}</style>
    </article>
  );
}
