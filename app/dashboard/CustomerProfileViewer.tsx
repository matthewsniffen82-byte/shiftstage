"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { ClubProfileDialog, type ProfileSelection } from "../internal/FullProfileDialog";
import type { PublicProfileActions } from "../internal/InternalFullProfile";
import type { CustomerSavedState } from "./dashboard-types";
import { captureBrowserAuthSessionGuard } from "@/src/lib/dancr/browser-session";
import { requestDashboardJson } from "./dashboard-session";

/** Keep the dashboard and its scroll position mounted while viewing a dancer. */
export function CustomerProfileViewer({ children, saved, onSavedChange }: { children: ReactNode; saved?: CustomerSavedState | null; onSavedChange?: (update: (current: CustomerSavedState) => CustomerSavedState) => void }) {
  const [selection, setSelection] = useState<(ProfileSelection & { slug: string; actions: PublicProfileActions }) | null>(null);
  const [error, setError] = useState("");
  const close = () => {
    setSelection(null);
    if (!onSavedChange) return;
    // Reconcile actions made inside the viewer without navigating or replacing
    // a newer dashboard edit that finished while this read was pending.
    const sameSession = captureBrowserAuthSessionGuard();
    void requestDashboardJson("/api/customer/saved", { expectedRole: "customer", timeoutMs: 15000 }).then(data => {
      if (data.saved && sameSession()) onSavedChange(current => current === saved ? { ...current, follows: data.saved.follows, goingSignals: data.saved.goingSignals, planEntryDeals: data.saved.planEntryDeals, dealRedemptions: data.saved.dealRedemptions } : current);
    }).catch(() => { if (sameSession()) setError("Your saved activity could not refresh. Please reload to see the latest changes."); });
  };
  const openProfile = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-profile-id]") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.origin);
    const slug = url.searchParams.get("profile");
    const id = link.dataset.profileId || "";
    if (url.origin !== window.location.origin || !slug || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return;
    const image = link.querySelector("img") || link.closest("article")?.querySelector("img");
    event.preventDefault();
    setError("");
    const follow = saved?.follows?.find(item => (item.dancerId || item.dancer?.id) === id);
    setSelection({ id, slug, stageName: link.dataset.profileName || "Dancer", photoUrl: image?.currentSrc || image?.src || "",
      actions: { following: !!follow, notificationsEnabled: follow?.notificationsEnabled === true,
        going: !!saved?.goingSignals?.some(item => item.shift?.dancer?.id === id && item.shift?.status === "posted") } });
  };
  return <>
    <div style={{ display: "contents" }} onClickCapture={openProfile}>{children}</div>
    {error ? <p className="customer-action-status" role="status">{error}</p> : null}
    <ClubProfileDialog prewarm profile={null} profileId={selection?.id || ""} publicSlug={selection?.slug}
      publicActions={selection?.actions} loadingIdentity={selection} onClose={close}
      onError={() => { setSelection(null); setError("That profile is unavailable right now. Please try again."); }} />
  </>;
}
