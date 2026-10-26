export type CampaignChannel = "in_app";
export type VenueCampaign = {
  id: string; channel: CampaignChannel; subject: string; body: string; sender_name: string; sender_address: string;
  status: "draft" | "published" | "cancelled"; created_at: string; queued_at: string | null;
  recipient_count: number; published_count: number; skipped_count: number;
};
export type OfferDigestItem = { campaignId: string; venueId: string; venueName: string; subject: string; address: string };
export function normalizeCampaignInput(input: Record<string, unknown>) {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim().replace(/\r\n?/g, "\n") : "";
  if (input.channel !== "in_app") throw new Error("Club offers are published inside MyDancr.");
  if (!body || body.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) throw new Error("Enter an offer up to 5,000 characters.");
  if (!subject || subject.length > 120 || /[\r\n\x00-\x1f\x7f]/.test(subject)) throw new Error("Enter a title up to 120 characters on one line.");
  return { channel: "in_app" as const, subject, body };
}
export function offerDigestEmail(items: OfferDigestItem[], appUrl: string, token: string) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const alerts = `${appUrl}/dashboard/customer#customer-alerts`;
  const unsubscribe = `${appUrl}/email-preferences/${token}`;
  const displayed = items.slice(0, 20);
  const heading = `${items.length} new club ${items.length === 1 ? "offer" : "offers"} in MyDancr`;
  const remaining = items.length > displayed.length ? `\nPlus ${items.length - displayed.length} more in Alerts.\n` : "";
  return {
    subject: `MyDancr: ${heading}`,
    text: `${heading}\n\n${displayed.map(item => `${item.venueName}: ${item.subject}\n${item.address}`).join("\n\n")}${remaining}\n\nView the full offers in Alerts:\n${alerts}\n\nThis is your daily club-offer summary.\nUnsubscribe from optional MyDancr emails: ${unsubscribe}`,
    html: `<h2>${escape(heading)}</h2><ul>${displayed.map(item => `<li><strong>${escape(item.venueName)}</strong>: ${escape(item.subject)}<br><small>${escape(item.address)}</small></li>`).join("")}</ul><p>${escape(remaining)}</p><p><a href="${escape(alerts)}">View offers in MyDancr Alerts</a></p><p>This is your daily club-offer summary.</p><p><a href="${escape(unsubscribe)}">Unsubscribe from optional MyDancr emails</a></p>`,
  };
}
