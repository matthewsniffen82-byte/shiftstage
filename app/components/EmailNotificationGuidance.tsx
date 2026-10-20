import "./email-notification-guidance.css";

const ACCOUNT_ALERT_REASONS = {
  customer: "Know when followed dancers are working and new club deals appear.",
  dancer: "Don’t miss table requests, VIP selections, or approval updates.",
  venue: "Respond quickly to table and VIP requests.",
  vip: "Stay updated on your VIP requests and confirmed visits.",
  admin: "Respond promptly to support messages that need your attention.",
};

export default function EmailNotificationGuidance({
  accountRole,
  clubApplication = false,
}: {
  accountRole: keyof typeof ACCOUNT_ALERT_REASONS;
  clubApplication?: boolean;
}) {
  const reason = accountRole === "venue" && clubApplication
    ? "Stay updated on your club application."
    : ACCOUNT_ALERT_REASONS[accountRole];

  return <aside className="email-notification-guidance" aria-label="Email alerts">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
    <div>
      <h2>Email alerts</h2>
      <p><strong>{reason}</strong> Emails are on by default. Enable phone alerts in your email app for the address you use with MyDancr.</p>
    </div>
  </aside>;
}
