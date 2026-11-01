// All addresses are aliases of the existing Zoho support mailbox. Resend sends
// app email; Zoho receives replies. Account links never get a shared-inbox copy.
export const EMAIL_ALIASES = {
  account: "no-reply@mydancr.com",
  notification: "notifications@mydancr.com",
  support: "support@mydancr.com",
  approvals: "approvals@mydancr.com",
  safety: "safety@mydancr.com",
  dmca: "dmca@mydancr.com",
  billing: "billing@mydancr.com",
  operations: "ops@mydancr.com",
  marketing: "updates@mydancr.com",
} as const;

export type EmailCategory = keyof typeof EMAIL_ALIASES;

export function emailHeaders(category: EmailCategory, replyTo?: string) {
  const replyCategory = ["account", "notification", "marketing"].includes(category) ? "support" : category;
  return {
    from: `MyDancr <${EMAIL_ALIASES[category]}>`,
    reply_to: replyTo || EMAIL_ALIASES[replyCategory],
  };
}

export function adminReviewEmailCategory(kind: string): EmailCategory {
  if (kind === "copyright_case") return "dmca";
  if (kind === "compliance_case" || kind === "content_report") return "safety";
  return "approvals";
}

export function notificationEmailCategory(row: { notification_type: string; payload?: unknown }): EmailCategory {
  if (row.notification_type === "dmca_status") return "dmca";
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown> : {};
  // Table, VIP and pickup notices also use support_message; only real support
  // conversations should use the support sender.
  if (row.notification_type === "support_message" && typeof payload.threadId === "string") return "support";
  if (payload.kind === "club_offer") return "marketing";
  return "notification";
}
