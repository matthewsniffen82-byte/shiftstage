export type PushInvitationMoment = "customer-follow" | "dancer-review" | "dancer-shift" | "venue-dashboard" | "venue-live" | "settings";

declare global {
  interface Window { mydancrPushInvitationsInstalled?: boolean; mydancrPendingPushInvitation?: PushInvitationMoment }
}

// Both the discovery shell and Next pages use the same small, optional card.
export function offerPushNotifications(moment: PushInvitationMoment) {
  if (!window.mydancrPushInvitationsInstalled) { window.mydancrPendingPushInvitation = moment; return; }
  window.dispatchEvent(new CustomEvent("mydancr:push-invitation", { detail: { moment } }));
}
