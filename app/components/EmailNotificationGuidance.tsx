import "./email-notification-guidance.css";

export default function EmailNotificationGuidance() {
  return <aside className="email-notification-guidance" aria-label="Email alerts">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
    <div>
      <h2>Email alerts</h2>
      <p><strong>Emails are on by default.</strong> Enable phone alerts for your signup address in your email app.</p>
    </div>
  </aside>;
}
