// Invitation returns are deliberately limited to VIP entry, never arbitrary URLs.
export function vipReturnPath(value: unknown) {
  return typeof value === "string" && (value === "/vip" || /^\/vip\/invite\/vip_[A-Za-z0-9_-]{48}$/.test(value)) ? value : "";
}

export function vipPasswordSetupPath(returnTo: unknown) {
  return `/account/reset-password?setup=1&return_to=${encodeURIComponent(vipReturnPath(returnTo) || "/vip")}`;
}

export function vipPlannerPath(venueId: unknown) {
  if (typeof venueId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) {
    throw new Error("VIP access was activated. Open your VIP lounge to continue.");
  }
  return `/vip?venueId=${encodeURIComponent(venueId)}#vip-plan`;
}
