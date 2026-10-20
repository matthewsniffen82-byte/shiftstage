import "./email-notification-guidance.css";

export default function EmailNotificationGuidance() {
  return <aside className="email-notification-guidance" aria-label="Email alerts on your phone">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
    <div>
      <h2>Email alerts on your phone</h2>
      <p><strong>Email notifications are already on by default in MyDancr</strong>, unless you turned them off.</p>
      <p>To see alerts as soon as emails arrive, allow notifications for your email app in your phone&apos;s Settings. In that app, turn on alerts for <strong>the email address you used to sign up for MyDancr</strong>.</p>
    </div>
  </aside>;
}
