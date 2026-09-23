"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import { CUSTOMER_FOLLOW_ALERTS, customerNotificationSettings, type CustomerNotificationKey } from "@/src/lib/dancr/customer-notification-preferences";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { CustomerDashboardIcon, type CustomerDashboardSectionId } from "./CustomerDashboardIdentity";
import { DEVICE_SAVED_DEALS_CHANGED_EVENT, removeDeviceSavedClubDeal } from "@/src/lib/dancr/customer-device-deals";
import { readSession, requestCustomerProfileJson, requestDashboardJson } from "./dashboard-session";
import type { CustomerDancerFollow, CustomerSavedState, SavedDancerSummary, SavedShiftSummary, SavedVenueSummary, CustomerVenueFollow, CustomerGoingSignal, LoadState, SavedImageSummary } from "./dashboard-types";
import { openDashboardSection, customerDirectionsHref, DashboardSection, customerDancerHref, customerVenueHref, customerInitials } from "./DashboardShared";
const customerDashboardCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});


function customerFollowedDancerCity(item: CustomerDancerFollow) {
  const dancer = item.dancer;
  return String(dancer?.city || dancer?.nextShift?.venue.city || "").trim() || "City not listed";
}


function groupFollowedDancersByCity(items: CustomerDancerFollow[]) {
  const grouped = new Map<string, { city: string; follows: CustomerDancerFollow[] }>();

  for (const item of items) {
    const city = customerFollowedDancerCity(item);
    const key = city.toLocaleLowerCase("en-US");
    const group = grouped.get(key) || { city, follows: [] };
    group.follows.push(item);
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      follows: group.follows.slice().sort((left, right) => customerDashboardCollator.compare(
        String(left.dancer?.stageName || ""),
        String(right.dancer?.stageName || ""),
      )),
    }))
    .sort((left, right) => {
      if (left.city === "City not listed") return 1;
      if (right.city === "City not listed") return -1;
      return customerDashboardCollator.compare(left.city, right.city);
    });
}


function customerFollowedVenueCity(item: CustomerVenueFollow) {
  return String(item.venue?.city || "").trim() || "City not listed";
}


function groupFollowedVenuesByCity(items: CustomerVenueFollow[]) {
  const grouped = new Map<string, { city: string; follows: CustomerVenueFollow[] }>();

  for (const item of items) {
    const city = customerFollowedVenueCity(item);
    const key = city.toLocaleLowerCase("en-US");
    const group = grouped.get(key) || { city, follows: [] };
    group.follows.push(item);
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      follows: group.follows.slice().sort((left, right) => customerDashboardCollator.compare(
        String(left.venue?.name || ""),
        String(right.venue?.name || ""),
      )),
    }))
    .sort((left, right) => {
      if (left.city === "City not listed") return 1;
      if (right.city === "City not listed") return -1;
      return customerDashboardCollator.compare(left.city, right.city);
    });
}


export function AgentDashboardShortcut() {
  return <Link className="agent-dashboard-shortcut" href="/dashboard/agent">
    <span><small>Venue partnerships</small><strong>Club referrals & commissions</strong></span>
    <b>Open agent dashboard →</b>
  </Link>;
}


export function CustomerWelcomeCard({ accountKey, show }: { accountKey: string; show: boolean }) {
  const [visible, setVisible] = useState(show);
  const storageKey = `mydancr:customer-welcome-dismissed:${accountKey}`;

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return;
    }
    try {
      setVisible(window.localStorage.getItem(storageKey) !== "1");
    } catch {
      setVisible(true);
    }
  }, [show, storageKey]);

  function dismissWelcome() {
    setVisible(false);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Dismissing still works for this visit if storage is unavailable.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("confirmed");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (!visible) return null;

  return (
    <section className="customer-welcome-card" aria-labelledby="customer-welcome-title">
      <div className="customer-welcome-lock" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
      </div>
      <div className="customer-welcome-copy">
        <span className="eyebrow">Private guest account</span>
        <h2 id="customer-welcome-title">Your private MyDancr account is ready</h2>
        <p>Build your night without putting your account or activity on a public profile.</p>
        <ul>
          <li>Follow dancers and clubs</li>
          <li>Save favorite profiles and Club Deals</li>
          <li>Get Working Now and schedule alerts</li>
          <li>Use I&apos;m Going to keep upcoming shifts together</li>
        </ul>
        <div className="customer-welcome-actions">
          <Link href={homeDiscoveryHref("dancers")} onClick={dismissWelcome}>Explore dancers</Link>
          <Link href={homeDiscoveryHref("venues")} onClick={dismissWelcome}>View Club Deals</Link>
        </div>
      </div>
      <button type="button" onClick={dismissWelcome} aria-label="Dismiss guest account welcome">×</button>
    </section>
  );
}


export function CustomerDashboardNav({ saved }: { saved?: CustomerSavedState | null }) {
  const now = useCustomerMinuteClock();
  const goingCount = (saved?.goingSignals || []).filter((item) => (
    item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now
  )).length;
  const links: Array<{ id: CustomerDashboardSectionId; label: string; count: number }> = [
    { id: "customer-followed-dancers", label: "Followed Dancers", count: saved?.follows?.length || 0 },
    { id: "customer-followed-clubs", label: "Favorite Clubs", count: saved?.venueFollows?.length || 0 },
    { id: "customer-saved-deals", label: "Saved Club Deals", count: saved?.dealSaves?.length || 0 },
    { id: "customer-going", label: "I’m Going", count: goingCount },
  ];

  return (
    <nav className="customer-dashboard-nav" aria-label="Customer dashboard sections">
      <div className="customer-dashboard-primary-links">
        {links.map((link) => (
          <a href={`#${link.id}`} key={link.id} onClick={(event) => openDashboardSection(event, link.id)}>
            <span className="customer-shortcut-icon"><CustomerDashboardIcon section={link.id} /></span>
            <span>{link.label}</span>
            <strong>{link.count}</strong>
          </a>
        ))}
      </div>
      <div className="customer-dashboard-utility-links" aria-label="Customer dashboard utilities">
        <a href="#customer-alerts" onClick={(event) => openDashboardSection(event, "customer-alerts")}><CustomerDashboardIcon section="customer-alerts" />Alerts</a>
        <a href="#customer-account" onClick={(event) => openDashboardSection(event, "customer-account")}><CustomerDashboardIcon section="customer-account" />Account</a>
      </div>
    </nav>
  );
}


export function CustomerPanel({
  isLoading,
  accountSavedUnavailable,
  onSavedChange,
  saved,
}: {
  isLoading: boolean;
  accountSavedUnavailable: boolean;
  onSavedChange: (update: (saved: CustomerSavedState) => CustomerSavedState) => void;
  saved?: LoadState["saved"];
}) {
  const now = useCustomerMinuteClock();
  const goingCount = (saved?.goingSignals || []).filter((item) => (
    item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now
  )).length;
  const [pendingAction, setPendingAction] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  function beginCustomerAction(actionKey: string) {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setPendingAction(actionKey);
    setActionStatus("");
    return { requestId, controller };
  }

  function isCurrentCustomerAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishCustomerAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (mountedRef.current) setPendingAction("");
  }

  async function runCustomerAction(
    actionKey: string,
    path: string,
    body: Record<string, unknown>,
    apply: (current: CustomerSavedState) => CustomerSavedState,
    successMessage: string,
  ) {
    const action = beginCustomerAction(actionKey);
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestDashboardJson(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        expectedRole: "customer",
        fallbackMessage: "Unable to update your dashboard.",
        signal: controller.signal,
      });
      if (!isCurrentCustomerAction(requestId, controller)) return;
      onSavedChange(apply);
      setActionStatus(successMessage);
    } catch (error) {
      if (isCurrentCustomerAction(requestId, controller)) setActionStatus(error instanceof Error ? error.message : "Unable to update your dashboard.");
    } finally {
      finishCustomerAction(requestId);
    }
  }

  function updateVenueFollow(venueId: string, following: boolean) {
    return runCustomerAction(
      `venue-${venueId}`,
      "/api/customer/venue-follows",
      { venueId, following, notificationsEnabled: following },
      (current) => ({
        ...current,
        venueFollows: following
          ? (current.venueFollows || []).map((item) => item.venueId === venueId ? { ...item, notificationsEnabled: true } : item)
          : (current.venueFollows || []).filter((item) => item.venueId !== venueId),
      }),
      following ? "Club added to favorites." : "Club removed from favorites.",
    );
  }

  function unfollowDancer(dancerId: string) {
    return runCustomerAction(
      `dancer-${dancerId}`,
      "/api/customer/follows",
      { dancerId, following: false, notificationsEnabled: false },
      (current) => ({
        ...current,
        follows: (current.follows || []).filter((item) => String(item.dancerId || item.dancer?.id || "") !== dancerId),
      }),
      "Dancer unfollowed.",
    );
  }

  function cancelGoing(shiftId: string) {
    return runCustomerAction(
      `going-${shiftId}`,
      "/api/customer/going",
      { shiftId, going: false },
      (current) => ({
        ...current,
        goingSignals: (current.goingSignals || []).filter((item) => item.shiftId !== shiftId),
      }),
      "Removed from I’m Going.",
    );
  }

  async function removeSavedDeal(dealId: string) {
    const bookmark = saved?.dealSaves?.find((item) => item.dealId === dealId);
    if (!bookmark) return;
    const action = beginCustomerAction(`deal-${dealId}`);
    if (!action) return;
    const { requestId, controller } = action;
    try {
      if (!bookmark.deviceOnly) {
        const result = await requestDashboardJson("/api/customer/deal-saves", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dealId, saved: false }),
          expectedRole: "customer",
          fallbackMessage: "Unable to remove this saved Club Deal. Please try again.",
          signal: controller.signal,
        });
        if (!isCurrentCustomerAction(requestId, controller)) return;
        if (result.persisted !== true || result.saved !== false) {
          throw new Error("Unable to remove this saved Club Deal from your account. Please try again.");
        }
        onSavedChange((current) => ({
          ...current,
          dealSaves: (current.dealSaves || []).filter((item) => item.dealId !== dealId),
        }));
      }
      try {
        removeDeviceSavedClubDeal(window.localStorage, dealId);
      } catch {
        throw new Error(bookmark.deviceOnly
          ? "Browser storage blocked removing this deal. Allow site storage and try again."
          : "Removed from your account, but the device copy could not be removed. Allow site storage and try again.");
      }
      window.dispatchEvent(new Event(DEVICE_SAVED_DEALS_CHANGED_EVENT));
      setActionStatus("Club Deal removed from your saved list.");
    } catch (error) {
      if (isCurrentCustomerAction(requestId, controller)) setActionStatus(error instanceof Error ? error.message : "Unable to remove this saved Club Deal.");
    } finally {
      finishCustomerAction(requestId);
    }
  }

  async function openDirections(venue: SavedVenueSummary, dancerId?: string | null) {
    const venueId = String(venue.id || "");
    if (!venueId) {
      setActionStatus("Venue directions are unavailable.");
      return;
    }
    const action = beginCustomerAction(`directions-${venueId}`);
    if (!action) return;
    const { requestId, controller } = action;
    try {
      await requestDashboardJson("/api/customer/directions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, dancerIds: dancerId ? [dancerId] : [] }),
        expectedRole: "customer",
        fallbackMessage: "Unable to open directions.",
        signal: controller.signal,
      });
      if (!isCurrentCustomerAction(requestId, controller)) return;
      window.location.assign(customerDirectionsHref(venue));
    } catch (error) {
      if (isCurrentCustomerAction(requestId, controller)) setActionStatus(error instanceof Error ? error.message : "Unable to open directions.");
    } finally {
      finishCustomerAction(requestId);
    }
  }

  return (
    <>
      {actionStatus ? <p className="customer-action-status" role="status">{actionStatus}</p> : null}
      {!accountSavedUnavailable ? <>
      <DashboardSection
        count={saved?.follows?.length}
        defaultOpen
        description="Dancers you follow, sorted by city. Tap a card to open the profile."
        id="customer-followed-dancers"
        icon={<CustomerDashboardIcon section="customer-followed-dancers" />}
        toggleAffordance="chevron"
        title="Followed Dancers"
      >
        <CustomerFollowedDancersPanel
          isLoading={isLoading}
          onUnfollowDancer={unfollowDancer}
          pendingAction={pendingAction}
          saved={saved}
        />
      </DashboardSection>
      <DashboardSection
        count={saved?.venueFollows?.length}
        description="Your saved clubs, with dancer activity and quick directions."
        id="customer-followed-clubs"
        icon={<CustomerDashboardIcon section="customer-followed-clubs" />}
        toggleAffordance="chevron"
        title="Favorite Clubs"
      >
        <CustomerFollowedClubsPanel
          isLoading={isLoading}
          onDirections={openDirections}
          onVenueFollowChange={updateVenueFollow}
          pendingAction={pendingAction}
          saved={saved}
        />
      </DashboardSection>
      </> : null}
      <DashboardSection
        count={saved?.dealSaves?.length}
        description="Offers you bookmarked privately for later."
        id="customer-saved-deals"
        icon={<CustomerDashboardIcon section="customer-saved-deals" />}
        toggleAffordance="chevron"
        title="Saved Club Deals"
      >
        {isLoading && !saved?.dealSaves?.length ? <p className="customer-loading-state">Loading your saved deals…</p> : <CustomerDealPassPanel
          deals={saved?.dealRedemptions || []}
          onDirections={openDirections}
          onRemoveSavedDeal={removeSavedDeal}
          pendingAction={pendingAction}
          savedDeals={saved?.dealSaves || []}
          accountSavedUnavailable={accountSavedUnavailable}
        />}
      </DashboardSection>
      {!accountSavedUnavailable ? <DashboardSection
        count={goingCount}
        description="Your plans, with shift details and directions."
        id="customer-going"
        icon={<CustomerDashboardIcon section="customer-going" />}
        toggleAffordance="chevron"
        title="I’m Going"
      >
        <CustomerNightPanel
          isLoading={isLoading}
          onCancelGoing={cancelGoing}
          onDirections={openDirections}
          pendingAction={pendingAction}
          signals={saved?.goingSignals || []}
        />
      </DashboardSection> : null}
    </>
  );
}


function CustomerNightPanel({
  isLoading,
  onCancelGoing,
  onDirections,
  pendingAction,
  signals,
}: {
  isLoading: boolean;
  onCancelGoing: (shiftId: string) => void;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  pendingAction: string;
  signals: CustomerGoingSignal[];
}) {
  const now = useCustomerMinuteClock();
  const plans = signals
    .filter((item) => item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now)
    .sort((left, right) => new Date(left.shift?.startsAt || 0).getTime() - new Date(right.shift?.startsAt || 0).getTime());

  return (
    <div className="customer-night-panel" tabIndex={-1}>
      <div className="customer-night-list">
        {plans.map((item) => {
          const shift = item.shift!;
          const dancer = shift.dancer;
          const venue = shift.venue;
          return (
            <article className="customer-night-card" key={item.shiftId}>
              <div className="customer-night-identity">
                <div className="customer-night-portrait">
                  <SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} sizes="112px" />
                </div>
                <div className="customer-night-copy">
                  <h3>{dancer.stageName || "Dancer"}</h3>
                  <p className="customer-night-venue">{venue.name || "Club"}</p>
                  <p className="customer-night-location">{[venue.city, venue.state].filter(Boolean).join(", ") || "Location unavailable"}</p>
                  <div className="customer-night-date">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></svg>
                    <span>{customerShiftLabel(shift)}</span>
                  </div>
                </div>
              </div>
              <div className="customer-night-controls">
                <div className="customer-card-actions customer-night-actions">
                  {dancer.slug ? <Link href={customerDancerHref(dancer)}>Dancer profile</Link> : null}
                  {venue.slug ? <Link href={customerVenueHref(venue)}>Club page</Link> : null}
                  <CustomerDirectionsButton
                    dancerId={dancer.id}
                    onDirections={onDirections}
                    pending={Boolean(pendingAction)}
                    venue={venue}
                  />
                </div>
                <button className="customer-night-cancel" type="button" disabled={Boolean(pendingAction)} aria-busy={pendingAction === `going-${item.shiftId}` || undefined} onClick={() => void onCancelGoing(item.shiftId)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
                  {pendingAction === `going-${item.shiftId}` ? "Cancelling…" : "Cancel Going"}
                </button>
              </div>
            </article>
          );
        })}
        {!plans.length && !isLoading ? (
          <div className="customer-empty-state">
            <strong>No plans yet</strong>
            <p>Choose I’m Going on a dancer’s next shift and it will appear here with the venue and directions.</p>
            <Link href={homeDiscoveryHref("dancers")}>Find dancers</Link>
          </div>
        ) : null}
        {isLoading ? <div className="customer-loading-state">Loading your plans…</div> : null}
      </div>
    </div>
  );
}


function CustomerFollowedDancersPanel({
  isLoading,
  onUnfollowDancer,
  pendingAction,
  saved,
}: {
  isLoading: boolean;
  onUnfollowDancer: (dancerId: string) => void;
  pendingAction: string;
  saved?: LoadState["saved"];
}) {
  const followedDancers = saved?.follows || [];
  const followedDancerCityGroups = groupFollowedDancersByCity(followedDancers);

  return (
    <div className="customer-saved-panel" tabIndex={-1}>
      <div className="customer-followed-city-list">
        {followedDancerCityGroups.map((group) => (
          <section className="customer-followed-city-group" key={group.city}>
            <div className="customer-followed-city-heading">
              <h3>{group.city}</h3>
              <span>{group.follows.length} {group.follows.length === 1 ? "dancer" : "dancers"}</span>
            </div>
            <div className="customer-saved-card-grid customer-followed-dancer-grid">
              {group.follows.map((item) => {
                const dancer = item.dancer;
                const dancerId = String(item.dancerId || dancer?.id || "");
                if (!dancerId) return null;
                if (!dancer?.slug || !dancer.stageName) return (
                  <article className="customer-unavailable-follow" key={dancerId}>
                    <div><strong>Unavailable dancer</strong><p>Your follow is saved. This profile is currently unavailable.</p></div>
                    <button type="button" disabled={Boolean(pendingAction)} onClick={() => void onUnfollowDancer(dancerId)}>
                      {pendingAction === `dancer-${dancerId}` ? "Unfollowing…" : "Unfollow"}
                    </button>
                  </article>
                );
                return (
                  <FollowedDancerGridCard
                    dancer={dancer}
                    key={dancerId}
                    onUnfollow={() => void onUnfollowDancer(dancerId)}
                    pending={Boolean(pendingAction)}
                    unfollowing={pendingAction === `dancer-${dancerId}`}
                  />
                );
              })}
            </div>
          </section>
        ))}
        {!followedDancers.length && !isLoading ? <CustomerSavedEmpty label="No followed dancers yet" href={homeDiscoveryHref("dancers")} cta="Browse dancers" /> : null}
      </div>
      {isLoading ? <div className="customer-loading-state">Loading followed dancers…</div> : null}
    </div>
  );
}


function CustomerFollowedClubsPanel({
  isLoading,
  onDirections,
  onVenueFollowChange,
  pendingAction,
  saved,
}: {
  isLoading: boolean;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  onVenueFollowChange: (venueId: string, following: boolean) => void;
  pendingAction: string;
  saved?: LoadState["saved"];
}) {
  const followedVenues = saved?.venueFollows || [];
  const followedVenueCityGroups = groupFollowedVenuesByCity(followedVenues);

  return (
    <div className="customer-saved-panel" tabIndex={-1}>
      <div className="customer-followed-city-list">
        {followedVenueCityGroups.map((group) => (
          <section className="customer-followed-city-group" key={group.city}>
            <div className="customer-followed-city-heading">
              <h3>{group.city}</h3>
              <span>{group.follows.length} {group.follows.length === 1 ? "club" : "clubs"}</span>
            </div>
            <div className="customer-saved-card-grid customer-favorite-club-grid">
              {group.follows.map((item, index) => {
                const venue = item.venue;
                const venueId = String(item.venueId || venue?.id || "");
                if (!venue?.slug || !venue.name || !venueId) return null;
                return (
                  <SavedVenueCard
                    key={`${venue.slug}-${index}`}
                    onDirections={onDirections}
                    onUnfollow={() => void onVenueFollowChange(venueId, false)}
                    pending={Boolean(pendingAction)}
                    removing={pendingAction === `venue-${venueId}`}
                    venue={venue}
                  />
                );
              })}
            </div>
          </section>
        ))}
        {!followedVenues.length && !isLoading ? <CustomerSavedEmpty label="No favorite clubs yet" href={homeDiscoveryHref("venues")} cta="Browse clubs" /> : null}
      </div>
      {isLoading ? <div className="customer-loading-state">Loading favorite clubs…</div> : null}
    </div>
  );
}


function FollowedDancerGridCard({
  dancer,
  onUnfollow,
  pending,
  unfollowing,
}: {
  dancer: SavedDancerSummary;
  onUnfollow: () => void;
  pending: boolean;
  unfollowing: boolean;
}) {
  const shift = dancer.nextShift;
  const shiftLabel = shift ? customerShiftLabel(shift) : "";
  const isWorkingNow = shiftLabel === "Working now";
  const statusLabel = isWorkingNow ? "Working now" : "Not working now";
  const statusTone = isWorkingNow ? "working" : shift ? "upcoming" : "quiet";
  const dancerName = String(dancer.stageName || "Dancer");

  return (
    <article className="customer-followed-dancer-card">
    <Link
      aria-label={`Open ${dancerName} profile`}
      className="customer-followed-dancer-tile"
      href={customerDancerHref(dancer)}
    >
      <SavedCardImage
        image={dancer}
        name={dancerName}
        sizes="(max-width: 620px) 29vw, (max-width: 1100px) 30vw, 300px"
      />
      <span className="customer-followed-dancer-copy">
        <span className={`customer-followed-dancer-status is-${statusTone}`}>{statusLabel}</span>
        <strong>{dancerName}</strong>
        {shift?.venue.name ? <small>{shift.venue.name}</small> : null}
        {shift && !isWorkingNow ? <small className="customer-followed-dancer-time">{shiftLabel}</small> : null}
      </span>
    </Link>
    <button
      className="customer-dancer-unfollow"
      type="button"
      aria-label={`Unfollow ${dancerName}`}
      aria-busy={unfollowing || undefined}
      disabled={pending}
      onClick={onUnfollow}
    >
      {unfollowing ? "Unfollowing…" : "Unfollow"}
    </button>
    </article>
  );
}


function SavedVenueCard({
  onDirections,
  onUnfollow,
  pending,
  removing,
  venue,
}: {
  onDirections: (venue: SavedVenueSummary) => void;
  onUnfollow: () => void;
  pending: boolean;
  removing: boolean;
  venue: SavedVenueSummary;
}) {
  return (
    <article className="customer-saved-card customer-favorite-club-card">
      <div className="customer-favorite-club-header">
        <div className="customer-favorite-club-brand">
          <Link className="customer-favorite-club-logo" href={customerVenueHref(venue)} aria-label={`Open ${venue.name || "club"} page`}>
            <SavedVenueLogo venue={venue} />
          </Link>
        </div>
        <div className="customer-favorite-club-identity">
          <Link href={customerVenueHref(venue)}><strong>{venue.name}</strong></Link>
          <small>{[venue.city, venue.state].filter(Boolean).join(", ") || "Location unavailable"}</small>
        </div>
        <button
          className="customer-club-favorite"
          type="button"
          aria-label={`Remove ${venue.name || "club"} from favorites`}
          title="Remove from favorites"
          aria-pressed="true"
          aria-busy={removing || undefined}
          disabled={pending}
          onClick={onUnfollow}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
        </button>
      </div>
      <div className="customer-saved-card-copy customer-favorite-club-copy">
        <div className="customer-club-activity" aria-label={`Dancers at ${venue.name || "this club"}`}>
          <Link className={`customer-club-activity-stat is-now${venue.activity?.workingNowCount ? " has-dancers" : ""}`} href={`${customerVenueHref(venue)}#venue-working-now`}>
            <i aria-hidden="true" /><strong>{venue.activity?.workingNowCount ?? "—"}</strong><span>Now</span>
          </Link>
        </div>
        {!venue.activity ? <small className="customer-club-activity-unavailable">Dancer counts unavailable. Open the club page for updates.</small> : null}
        <div className="customer-card-actions customer-favorite-club-actions">
          <Link href={customerVenueHref(venue)}>Club page <span aria-hidden="true">↗</span></Link>
          <CustomerDirectionsButton onDirections={onDirections} pending={pending} venue={venue} />
        </div>
      </div>
    </article>
  );
}


function SavedVenueLogo({ venue }: { venue: SavedVenueSummary }) {
  const logoUrl = venue.logoImageUrl || verifiedVenueLogoUrl(venue.slug);
  const [failedUrl, setFailedUrl] = useState("");
  if (!logoUrl || failedUrl === logoUrl) {
    return <svg className="customer-club-logo-fallback" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 54V22L32 10l20 12v32M8 54h48M23 54V40h18v14M23 25h18M23 32h18" /></svg>;
  }
  return <img src={logoUrl} srcSet={venue.logoImageSrcSet || undefined} sizes="(max-width: 380px) 104px, 124px" width={venue.logoImageWidth || undefined} height={venue.logoImageHeight || undefined} alt={`${venue.name || "Club"} logo`} loading="lazy" decoding="async" onError={() => setFailedUrl(logoUrl)} />;
}


function CustomerDirectionsButton({
  dancerId,
  onDirections,
  pending,
  venue,
}: {
  dancerId?: string | null;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  pending: boolean;
  venue: SavedVenueSummary;
}) {
  return (
    <button
      aria-label="Directions"
      disabled={pending}
      onClick={() => void onDirections(venue, dancerId)}
      type="button"
    >
      Directions
    </button>
  );
}


function SavedCardImage({
  image,
  name,
  sizes = "(max-width: 860px) calc(100vw - 72px), (max-width: 1200px) 30vw, 340px",
}: {
  image: SavedImageSummary;
  name: string;
  sizes?: string;
}) {
  if (image.imageUrl) {
    return (
      <img
        className="customer-saved-card-image"
        decoding="async"
        loading="lazy"
        src={image.imageUrl}
        srcSet={image.imageSrcSet || undefined}
        sizes={sizes}
        width={image.imageWidth || undefined}
        height={image.imageHeight || undefined}
        alt=""
      />
    );
  }
  return <span className="customer-saved-card-image fallback" aria-hidden="true">{customerInitials(name)}</span>;
}


function CustomerSavedEmpty({ cta, href, label }: { cta: string; href: string; label: string }) {
  return (
    <div className="customer-empty-state compact">
      <strong>{label}</strong>
      <Link href={href}>{cta}</Link>
    </div>
  );
}


function CustomerDealPassPanel({
  accountSavedUnavailable,
  deals,
  onDirections,
  onRemoveSavedDeal,
  pendingAction,
  savedDeals,
}: {
  accountSavedUnavailable: boolean;
  deals: NonNullable<NonNullable<LoadState["saved"]>["dealRedemptions"]>;
  onDirections: (venue: SavedVenueSummary) => void;
  onRemoveSavedDeal: (dealId: string) => void;
  pendingAction: string;
  savedDeals: NonNullable<NonNullable<LoadState["saved"]>["dealSaves"]>;
}) {
  const now = useCustomerMinuteClock();
  const activeDeals = deals
    .filter((item) => item.status === "generated" && new Date(item.expiresAt).getTime() > now)
    .sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime());
  const pastDeals = deals
    .filter((item) => !activeDeals.some((active) => active.id === item.id))
    .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());

  return (
    <article className="info-panel saved-deal-panel" tabIndex={-1}>
      <div className="saved-deal-head">
        <div>
          <span>Saved for later</span>
          <h2>Saved Club Deals</h2>
        </div>
        <strong>{savedDeals.length}</strong>
      </div>
      <p className="saved-deal-privacy-note">Saved deals are private bookmarks. Saving does not reserve, select, or redeem an offer.</p>
      <div className="saved-deal-list saved-deal-bookmarks">
        {savedDeals.map((item) => (
          <article className={`saved-deal-item saved-deal-bookmark${item.deviceOnly || item.deal.isActive ? "" : " unavailable"}`} key={item.dealId}>
            <span>
              <strong>{item.deal.title || "Club Deal"}</strong>
              <small>{item.venue.name || "Club"} · {item.deviceOnly ? "Saved on this device" : savedClubDealAvailability(item.deal)}</small>
            </span>
            <div className="customer-card-actions">
              {item.venue.slug ? <Link href={customerVenueHref(item.venue)}>View deal</Link> : null}
              <CustomerDirectionsButton onDirections={onDirections} pending={Boolean(pendingAction)} venue={item.venue} />
              <button
                className="customer-text-action"
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => void onRemoveSavedDeal(item.dealId)}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
        {accountSavedUnavailable ? <p role="status">Account saves could not be loaded. Any deals saved on this device are shown here. Try loading your saved activity again above.</p> : null}
        {!savedDeals.length && !accountSavedUnavailable ? (
          <div className="customer-empty-state">
            <strong>No saved Club Deals yet</strong>
            <p>Save an offer from a club or dancer profile and it will appear here without redeeming it.</p>
            <Link href={homeDiscoveryHref("venues")}>Browse Club Deals</Link>
          </div>
        ) : null}
      </div>
      {deals.length ? (
        <details className="customer-deal-activity">
          <summary>
            <span>Club Deal use &amp; history</span>
            <strong>{activeDeals.length} active</strong>
          </summary>
          <div>
            <section className="customer-nfc-guide" aria-label="How admission passes work">
              <div><b>1</b><span><strong>Choose the exact deal</strong><small>Open an offer from a venue or a Working Now dancer and choose your arrival method.</small></span></div>
              <div><b>2</b><span><strong>Show your pass</strong><small>Open your admission pass and show the QR code to club staff.</small></span></div>
              <div><b>3</b><span><strong>Wait for confirmation</strong><small>Staff verifies your arrival method and scans the pass to confirm one admission.</small></span></div>
            </section>
            <div className="saved-deal-list">
              {activeDeals.map((item) => (
                <Link
                  className="saved-deal-item"
                  href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`}
                  key={item.id}
                >
                  <span>
                    <strong>{item.deal?.title || "Club Deal"}</strong>
                    <small>{item.venue?.name || "Venue"} · {dealExpiryLabel(item.expiresAt, now)}</small>
                  </span>
                  <em>Open details</em>
                </Link>
              ))}
              {!activeDeals.length ? (
                <div className="customer-empty-state compact">
                  <strong>No active Club Deals</strong>
                  <p>Choose a Club Deal and generate your admission pass before arriving.</p>
                </div>
              ) : null}
              {pastDeals.length ? (
                <details className="past-deal-history">
                  <summary>Past deals <span>{pastDeals.length}</span></summary>
                  <div>
                    {pastDeals.map((item) => {
                      const expired = new Date(item.expiresAt).getTime() <= now;
                      return (
                        <Link className="saved-deal-item unavailable" href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`} key={item.id}>
                          <span>
                            <strong>{item.deal?.title || "Club Deal"}</strong>
                            <small>{item.venue?.name || "Venue"} · {dealPassStatus(item.status, expired)}</small>
                          </span>
                          <em>View</em>
                        </Link>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </article>
  );
}


function savedClubDealAvailability(deal: {
  isActive: boolean;
  validDays?: string[] | null;
  validStartTime?: string | null;
  validEndTime?: string | null;
}) {
  if (!deal.isActive) return "No longer available";
  const days = (deal.validDays || []).map((day) => String(day).slice(0, 3)).filter(Boolean).join(", ");
  const start = formatSavedDealTime(deal.validStartTime);
  const end = formatSavedDealTime(deal.validEndTime);
  if (days && start && end) return `${days} · ${start}–${end}`;
  if (days) return `Valid ${days}`;
  if (start && end) return `${start}–${end}`;
  return "Active Club Deal";
}


function formatSavedDealTime(value?: string | null) {
  if (!value) return "";
  const [hourValue, minuteValue] = value.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${suffix}`;
}


function dealPassStatus(status: string, expired: boolean) {
  if (status === "redeemed") return "Redeemed";
  if (status === "voided") return "Ended";
  if (status === "expired" || expired) return "Expired";
  return "Ready";
}


function useCustomerMinuteClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}


function dealExpiryLabel(expiresAt: string, now: number) {
  const remainingMinutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
  if (remainingMinutes < 60) return `Expires in ${remainingMinutes} min`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) return `Expires in ${hours}h${minutes ? ` ${minutes}m` : ""}`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}


function customerShiftLabel(shift: Pick<SavedShiftSummary, "startsAt" | "endsAt" | "timezone" | "checkedInAt" | "checkedOutAt">) {
  const now = Date.now();
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  if (shift.checkedInAt && !shift.checkedOutAt && startsAt <= now && endsAt > now) return "Working now";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: shift.timezone || undefined,
    }).format(new Date(shift.startsAt));
  } catch {
    return new Date(shift.startsAt).toLocaleString();
  }
}


export function CustomerPreferencesPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown> | null | undefined) => void;
  profile?: LoadState["profile"];
}) {
  const [settings, setSettings] = useState(() => customerNotificationSettings(profile?.notificationSettings));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "success" | "error">("idle");
  const [pushDeviceEnabled, setPushDeviceEnabled] = useState(false);
  const [pushSupportMessage, setPushSupportMessage] = useState("");
  const delivery = (profile?.notificationDelivery || {}) as CustomerNotificationDelivery;
  const userId = String(profile?.userId || "");
  useEffect(() => {
    let active = true;
    const sync = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.userId !== userId || readSession()?.account?.id !== userId) return;
      void customerPushDeviceEnabled(userId).then(enabled => {
        if (active && readSession()?.account?.id === userId) setPushDeviceEnabled(enabled);
      });
      if (detail.profile) {
        setSettings(customerNotificationSettings(detail.profile.notificationSettings));
        onProfileChange?.(detail.profile);
      }
    };
    window.addEventListener("mydancr:push-changed", sync);
    return () => { active = false; window.removeEventListener("mydancr:push-changed", sync); };
  }, [userId, onProfileChange]);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSettings(customerNotificationSettings(profile?.notificationSettings));
  }, [profile]);

  useEffect(() => {
    let active = true;
    const refreshDevice = () => {
      setPushSupportMessage(customerPushSupportMessage());
      void customerPushDeviceEnabled(userId).then(enabled => { if (active) setPushDeviceEnabled(enabled); });
    };
    refreshDevice();
    window.addEventListener("focus", refreshDevice);
    return () => { active = false; window.removeEventListener("focus", refreshDevice); };
  }, [userId]);

  function beginPreferencesAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentPreferencesAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishPreferencesAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return false;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function savePreference(key: CustomerNotificationKey, nextEnabled: boolean) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginPreferencesAction();
    if (!action) return;
    const { requestId, controller } = action;
    const previousSettings = settings;
    setSettings({ ...settings, [key]: nextEnabled });
    setIsSaving(true);
    setSavingKey(key);
    setSavedKey("");
    setFeedbackState("idle");
    setStatus("");
    try {
      if (key === "pushEnabled" && nextEnabled) {
        await enableCustomerPush(delivery, userId, () => {
          if (!isCurrentPreferencesAction(requestId, controller) || readSession()?.account?.id !== userId) throw new Error("Your session changed. Please try again.");
        });
      }
      const data = await requestCustomerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationSettings: { [key]: nextEnabled } }),
        fallbackMessage: "Unable to update notifications.",
        signal: controller.signal,
      });
      if (!isCurrentPreferencesAction(requestId, controller)) return;
      const confirmedSettings = data.profile?.notificationSettings;
      const settingWasSaved = confirmedSettings
        && typeof confirmedSettings === "object"
        && !Array.isArray(confirmedSettings)
        && (confirmedSettings as Record<string, unknown>)[key] === nextEnabled;
      if (!settingWasSaved) {
        throw new Error("Your notification setting was not confirmed. Please try again.");
      }
      setSettings(customerNotificationSettings(confirmedSettings));
      onProfileChange?.(data.profile);
      if (key === "pushEnabled") {
        if (!nextEnabled) await disableCustomerPush();
        if (isCurrentPreferencesAction(requestId, controller)) setPushDeviceEnabled(nextEnabled);
      }
      if (isCurrentPreferencesAction(requestId, controller)) {
        setSavedKey(key);
        setFeedbackState("success");
        setStatus("✓ Notification preferences saved.");
      }
    } catch (error) {
      if (key === "pushEnabled" && nextEnabled && readSession()?.account?.id === userId) await disableCustomerPush();
      if (isCurrentPreferencesAction(requestId, controller)) {
        setSettings(previousSettings);
        setFeedbackState("error");
        setStatus(error instanceof Error ? error.message : "Unable to update notifications.");
      }
    } finally {
      if (finishPreferencesAction(requestId)) { setIsSaving(false); setSavingKey(""); }
    }
  }

  return (
    <article className="info-panel customer-settings-panel customer-notification-preferences">
      <div className="customer-alert-preferences-heading">
        <div>
          <h2>Notification preferences</h2>
          <p>Choose the updates you want from dancers and favorite clubs.</p>
        </div>
      </div>
      <div className="customer-preference-row customer-preference-master">
        <span><strong>Follow alerts</strong><small>Pause or resume all four alert types.</small></span>
        <CustomerNotificationSwitch label="Follow alerts" checked={settings.followAlertsEnabled} disabled={isSaving} busy={savingKey === "followAlertsEnabled"} saved={savedKey === "followAlertsEnabled"} onChange={() => void savePreference("followAlertsEnabled", !settings.followAlertsEnabled)} />
      </div>
      {!settings.followAlertsEnabled ? <p className="customer-alert-preferences-copy">Follow alerts are paused. Your individual choices are kept below.</p> : null}
      <div className="customer-preference-list" aria-label="Alert types">
        {CUSTOMER_FOLLOW_ALERTS.map((alert) => (
          <div className="customer-preference-row" key={alert.key}>
            <span><strong>{alert.title}</strong><small>{alert.description}</small></span>
            <CustomerNotificationSwitch label={alert.title} checked={settings[alert.key]} disabled={isSaving} busy={savingKey === alert.key} saved={savedKey === alert.key} onChange={() => void savePreference(alert.key, !settings[alert.key])} />
          </div>
        ))}
      </div>
      <div className="customer-delivery-heading"><h3>Delivery options</h3><p>Your alerts appear here. Email and push are optional.</p></div>
      <div className="customer-preference-list">
        <div className="customer-preference-row">
          <span><strong>Email</strong><small>{delivery.emailAvailable ? "Send alerts to your account email." : "Email alerts are not available yet."}</small></span>
          <CustomerNotificationSwitch label="Email notifications" checked={settings.emailEnabled} disabled={isSaving || (!delivery.emailAvailable && !settings.emailEnabled)} busy={savingKey === "emailEnabled"} saved={savedKey === "emailEnabled"} onChange={() => void savePreference("emailEnabled", !settings.emailEnabled)} />
        </div>
        <div className="customer-preference-row">
          <span><strong>Push notifications</strong><small>{!delivery.pushAvailable ? "Push notifications are not available yet." : pushSupportMessage || (pushDeviceEnabled ? "Enabled on this device." : "Allow alerts from your browser, even when MyDancr is closed.")}</small></span>
          <CustomerNotificationSwitch label="Push notifications" checked={settings.pushEnabled} disabled={isSaving || ((!delivery.pushAvailable || Boolean(pushSupportMessage)) && !settings.pushEnabled)} busy={savingKey === "pushEnabled"} saved={savedKey === "pushEnabled"} onChange={() => void savePreference("pushEnabled", !settings.pushEnabled)} />
        </div>
        {settings.pushEnabled && !pushDeviceEnabled && delivery.pushAvailable && !pushSupportMessage ? <button className="customer-push-device-button" type="button" disabled={isSaving} onClick={() => void savePreference("pushEnabled", true)}>Enable push on this device</button> : null}
      </div>
      <p className="customer-alert-status" data-action-state={isSaving ? "saving" : feedbackState} role={feedbackState === "error" ? "alert" : "status"} aria-live="polite">{isSaving ? "Saving your preference…" : status || "Changes save automatically."}</p>
    </article>
  );
}


function CustomerNotificationSwitch({ label, checked, disabled, busy, saved, onChange }: { label: string; checked: boolean; disabled: boolean; busy: boolean; saved: boolean; onChange: () => void }) {
  return <button className="customer-notification-switch" data-action-state={busy ? "saving" : saved ? "success" : "idle"} type="button" role="switch" aria-label={label} aria-checked={checked} aria-busy={busy || undefined} disabled={disabled} onClick={onChange}>
    <span className="customer-switch-track" aria-hidden="true"><i /></span><span className="customer-switch-state" aria-hidden="true">{busy ? "Saving…" : saved ? "✓ Saved" : checked ? "On" : "Off"}</span>
  </button>;
}
