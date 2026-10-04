"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import { CUSTOMER_FOLLOW_ALERTS, customerNotificationSettings, type CustomerNotificationKey } from "@/src/lib/dancr/customer-notification-preferences";
import { customerPushDeviceEnabled, customerPushSupportMessage, disableCustomerPush, enableCustomerPush, type CustomerNotificationDelivery } from "@/src/lib/dancr/customer-push";
import { CustomerDashboardIcon } from "./CustomerDashboardIdentity";
import { DEVICE_SAVED_DEALS_CHANGED_EVENT, removeDeviceSavedClubDeal } from "@/src/lib/dancr/customer-device-deals";
import { readSession, requestCustomerProfileJson, requestDashboardJson } from "./dashboard-session";
import type { CustomerDancerFollow, CustomerSavedState, SavedDancerSummary, SavedShiftSummary, SavedVenueSummary, CustomerVenueFollow, CustomerGoingSignal, LoadState, SavedImageSummary } from "./dashboard-types";
import { customerDirectionsHref, customerDancerHref, customerVenueHref, customerInitials } from "./DashboardShared";
import { customerDashboardDestination, type CustomerView, type CustomerSavedFilter } from "./customer-dashboard-view";
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
      </div>
      <button type="button" onClick={dismissWelcome} aria-label="Dismiss guest account welcome">×</button>
    </section>
  );
}


export function CustomerDashboardNav({ active, onNavigate, alertCount = 0 }: {
  active: CustomerView;
  onNavigate: (view: CustomerView) => void;
  alertCount?: number;
}) {
  const links = [
    { id: "night", label: "My Night", icon: "customer-going" },
    { id: "saved", label: "Saved", icon: "customer-followed-clubs" },
    { id: "alerts", label: "Alerts", icon: "customer-alerts" },
    { id: "account", label: "Account", icon: "customer-account" },
  ] as const;
  return <nav className="customer-workspace-nav" aria-label="Customer dashboard">
    {links.map(item => <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined}
      aria-controls={`customer-view-${item.id}`} onClick={() => onNavigate(item.id)}>
      <CustomerDashboardIcon section={item.icon} /><span>{item.label}</span>
      {item.id === "alerts" && alertCount > 0 ? <span className="customer-nav-count" aria-label={`${alertCount} unread alerts`}>{alertCount > 99 ? "99+" : alertCount}</span> : null}
    </button>)}
  </nav>;
}

function CustomerSurface({ id, title, description, count, children }: { id: string; title: string; description?: string; count?: number; children: ReactNode }) {
  return <section className="customer-surface" id={id} tabIndex={-1} aria-labelledby={`${id}-title`}>
    <header className="customer-surface-heading"><div><h2 id={`${id}-title`}>{title}</h2>{description ? <p>{description}</p> : null}</div>{count !== undefined ? <span className="customer-count">{count}</span> : null}</header>
    {children}
  </section>;
}

function CustomerExplore() {
  const [city, setCity] = useState("Las Vegas");
  const [cities, setCities] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/cities", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => {
      if (controller.signal.aborted || !Array.isArray(data?.cities)) return;
      const available = data.cities.filter((item: { value?: unknown; label?: unknown }) => typeof item.value === "string" && typeof item.label === "string");
      setCities(available);
      if (available.length && !available.some((item: { value: string }) => item.value === "Las Vegas")) setCity(available[0].value);
    }).catch(() => { /* Discovery links remain available if the city list cannot load. */ });
    return () => controller.abort();
  }, []);
  return <div className="customer-explore">
    <div><span className="eyebrow">Make it your night</span><h2>Find your next favorite.</h2><p>Follow dancers and clubs. Keep your plans and passes together, privately.</p></div>
    {cities.length ? <label>Explore a city<select value={city} onChange={event => setCity(event.target.value)}>{cities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
    <div className="customer-card-actions"><Link className="customer-primary" href={homeDiscoveryHref("dancers", city)}>Find dancers</Link><Link href={homeDiscoveryHref("venues", city)}>Explore clubs</Link></div>
  </div>;
}

export function CustomerPanel({
  isLoading,
  accountSavedUnavailable,
  onSavedChange,
  saved,
  initialSection,
  alertsContent,
  accountContent,
  welcomeContent,
  alertCount,
}: {
  initialSection?: string;
  alertsContent?: ReactNode;
  accountContent?: ReactNode;
  welcomeContent?: ReactNode;
  alertCount?: number;
  isLoading: boolean;
  accountSavedUnavailable: boolean;
  onSavedChange: (update: (saved: CustomerSavedState) => CustomerSavedState) => void;
  saved?: LoadState["saved"];
}) {
  const now = useCustomerMinuteClock();
  const goingCount = (saved?.goingSignals || []).filter((item) => (
    item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now
  )).length;
  const initial = customerDashboardDestination("", initialSection);
  const [view, setView] = useState<CustomerView>(initial.view);
  const [savedFilter, setSavedFilter] = useState<CustomerSavedFilter>(initial.filter);
  const [city, setCity] = useState("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const navigationFrameRef = useRef(0);

  function focusDestination(id: string, scroll = false) {
    window.cancelAnimationFrame(navigationFrameRef.current);
    navigationFrameRef.current = window.requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (!target || !workspaceRef.current?.contains(target)) return;
      let parent: HTMLElement | null = target;
      while (parent && parent !== workspaceRef.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      if (scroll) target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    const sync = () => {
      const destination = customerDashboardDestination(window.location.hash, initialSection);
      setView(destination.view);
      setSavedFilter(destination.filter);
      if (window.location.hash) focusDestination(window.location.hash.slice(1), true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("hashchange", sync); window.cancelAnimationFrame(navigationFrameRef.current); };
  }, [initialSection, isLoading]);

  function navigate(next: CustomerView) {
    setView(next);
    const savedId = savedFilter === "dancers" ? "customer-followed-dancers" : savedFilter === "clubs" ? "customer-followed-clubs" : "customer-saved-deals";
    window.history.replaceState(null, "", `#${next === "saved" ? savedId : `customer-${next}`}`);
    focusDestination(`customer-view-${next}`, true);
  }
  function chooseSaved(next: CustomerSavedFilter) {
    setSavedFilter(next);
    window.history.replaceState(null, "", `#${next === "dancers" ? "customer-followed-dancers" : next === "clubs" ? "customer-followed-clubs" : "customer-saved-deals"}`);
  }
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

  const cities = Array.from(new Set([
    ...(saved?.follows || []).map(customerFollowedDancerCity),
    ...(saved?.venueFollows || []).map(customerFollowedVenueCity),
    ...(saved?.dealSaves || []).map(item => item.venue.city || "City not listed"),
  ])).sort(customerDashboardCollator.compare);
  const selectedCity = cities.includes(city) ? city : "";
  const filteredSaved = selectedCity ? {
    ...saved,
    follows: saved?.follows?.filter(item => customerFollowedDancerCity(item) === selectedCity),
    venueFollows: saved?.venueFollows?.filter(item => customerFollowedVenueCity(item) === selectedCity),
    dealSaves: saved?.dealSaves?.filter(item => (item.venue.city || "City not listed") === selectedCity),
  } : saved;
  const workingFollows = (saved?.follows || []).filter(item => item.dancer?.slug && item.dancer.nextShift?.status === "posted" && customerShiftLabel(item.dancer.nextShift) === "Working now");
  const exploreFirst = !isLoading && !saved?.follows?.length && !saved?.goingSignals?.length && !saved?.dealRedemptions?.length;
  return <div className="customer-workspace" ref={workspaceRef}>
    <CustomerDashboardNav active={view} onNavigate={navigate} alertCount={alertCount} />
    {actionStatus ? <p className="customer-action-status" role="status">{actionStatus}</p> : null}
    <section id="customer-view-night" className="customer-view" hidden={view !== "night"} aria-label="My Night" tabIndex={-1}>
      {welcomeContent}
      <div className="customer-view-heading"><span className="eyebrow">Your private guest account</span><h2>My Night</h2><p>Your passes, plans, and people. Ready when you are.</p></div>
      {isLoading ? <p className="customer-loading-state" role="status">Loading your night…</p> : null}
      {!accountSavedUnavailable ? <>
        {exploreFirst ? <CustomerExplore /> : null}
        <CustomerPassWallet deals={saved?.dealRedemptions || []} isLoading={isLoading} />
        <CustomerSurface id="customer-going" title="Your plans" description="Your I’m Going list. Plans are not reservations or confirmed bookings." count={goingCount}>
          <CustomerNightPanel isLoading={isLoading} onCancelGoing={cancelGoing} onDirections={openDirections} pendingAction={pendingAction} signals={saved?.goingSignals || []} />
        </CustomerSurface>
        <CustomerSurface id="customer-working-now" title="Working Now" description="Dancers you follow who are checked in now." count={workingFollows.length}>
          {workingFollows.length ? <div className="customer-saved-card-grid customer-followed-dancer-grid">{workingFollows.map(item => <FollowedDancerGridCard key={item.dancerId || item.dancer!.id} dancer={item.dancer!} onUnfollow={() => void unfollowDancer(String(item.dancerId || item.dancer!.id))} pending={Boolean(pendingAction)} unfollowing={pendingAction === `dancer-${item.dancerId || item.dancer!.id}`} />)}</div> : !isLoading ? <div className="customer-empty-state compact"><strong>{saved?.follows?.length ? "No followed dancers are working right now" : "Your favorites start here"}</strong><p>{saved?.follows?.length ? "Check Saved for their next posted shifts." : "Follow a dancer to see when they’re working."}</p><Link href={homeDiscoveryHref("dancers")}>Find dancers</Link></div> : null}
        </CustomerSurface>
        {!exploreFirst ? <CustomerExplore /> : null}
      </> : <p className="customer-loading-state">Your night is unavailable. Use Try again above to reload your saved activity.</p>}
    </section>
    <section id="customer-view-saved" className="customer-view" hidden={view !== "saved"} aria-label="Saved" tabIndex={-1}>
      <div className="customer-view-heading"><h2>Saved</h2><p>Your dancers, clubs, and offers. Just for you.</p></div>
      <div className="customer-saved-toolbar">
        <div className="customer-saved-filters" role="group" aria-label="Saved items">
          {(["dancers", "clubs", "deals"] as const).map((filter, index) => <button type="button" key={filter} aria-pressed={savedFilter === filter} aria-controls={filter === "dancers" ? "customer-followed-dancers" : filter === "clubs" ? "customer-followed-clubs" : "customer-saved-deals"} onClick={() => chooseSaved(filter)}>{["Dancers", "Clubs", "Deals"][index]}<span>{[filteredSaved?.follows?.length, filteredSaved?.venueFollows?.length, filteredSaved?.dealSaves?.length][index] || 0}</span></button>)}
        </div>
        {cities.length > 1 ? <label className="customer-city-filter">City<select value={selectedCity} onChange={event => setCity(event.target.value)}><option value="">All cities</option>{cities.map(value => <option value={value} key={value}>{value}</option>)}</select></label> : null}
      </div>
      <div id="customer-followed-dancers" hidden={savedFilter !== "dancers"} tabIndex={-1}>
        {!accountSavedUnavailable ? <CustomerFollowedDancersPanel isLoading={isLoading} onUnfollowDancer={unfollowDancer} pendingAction={pendingAction} saved={filteredSaved} /> : <p role="status">Your followed dancers could not be loaded. Try again above.</p>}
      </div>
      <div id="customer-followed-clubs" hidden={savedFilter !== "clubs"} tabIndex={-1}>
        {!accountSavedUnavailable ? <CustomerFollowedClubsPanel isLoading={isLoading} onDirections={openDirections} onVenueFollowChange={updateVenueFollow} pendingAction={pendingAction} saved={filteredSaved} /> : <p role="status">Your favorite clubs could not be loaded. Try again above.</p>}
      </div>
      <div id="customer-saved-deals" hidden={savedFilter !== "deals"} tabIndex={-1}>
        {isLoading && !saved?.dealSaves?.length ? <p className="customer-loading-state">Loading your saved deals…</p> : <CustomerDealPassPanel onDirections={openDirections} onRemoveSavedDeal={removeSavedDeal} pendingAction={pendingAction} savedDeals={filteredSaved?.dealSaves || []} accountSavedUnavailable={accountSavedUnavailable} />}
      </div>
    </section>
    <section id="customer-view-alerts" className="customer-view" hidden={view !== "alerts"} aria-label="Alerts" tabIndex={-1}>{alertsContent}</section>
    <section id="customer-view-account" className="customer-view" hidden={view !== "account"} aria-label="Account" tabIndex={-1}>{accountContent}</section>
  </div>;
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

  const groups = new Map<string, { label: string; venue: SavedVenueSummary; plans: typeof plans }>();
  for (const item of plans) {
    const shift = item.shift!;
    const date = new Date(shift.startsAt);
    let label: string;
    try { label = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: shift.timezone || undefined }).format(date); }
    catch { label = date.toLocaleDateString(); }
    const key = `${label}:${shift.venue.id || shift.venue.slug || shift.venue.name}`;
    const group = groups.get(key) || { label, venue: shift.venue, plans: [] };
    group.plans.push(item);
    groups.set(key, group);
  }
  return <div className="customer-night-panel" tabIndex={-1}>
    <div className="customer-night-list">
      {Array.from(groups.entries()).map(([key, group]) => <section className="customer-plan-group" key={key}>
        <header><span>{group.label}</span><h3>{group.venue.name || "Club"}</h3><small>{[group.venue.city, group.venue.state].filter(Boolean).join(", ")}</small></header>
        {group.plans.map(item => {
          const shift = item.shift!, dancer = shift.dancer, venue = shift.venue;
          const shiftLabel = customerShiftLabel(shift);
          return <article className="customer-night-card" key={item.shiftId} data-public-dancer-id={dancer.id}>
            <div className="customer-night-identity"><div className="customer-night-portrait"><SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} sizes="72px" /></div>
              <div className="customer-night-copy"><h3>{dancer.stageName || "Dancer"}</h3><p className="customer-night-date" data-working={shiftLabel === "Working now" || undefined}>{shiftLabel}</p></div>
            </div>
            <div className="customer-night-controls"><div className="customer-card-actions customer-night-actions">
              {dancer.slug ? <Link href={customerDancerHref(dancer)}>View profile</Link> : null}
              <CustomerDirectionsButton dancerId={dancer.id} onDirections={onDirections} pending={Boolean(pendingAction)} venue={venue} />
            </div><details className="customer-card-menu"><summary aria-label={`Manage plan for ${dancer.stageName || "dancer"}`}>•••</summary><div>
              {venue.slug ? <Link href={customerVenueHref(venue)}>Club page</Link> : null}
              <button type="button" disabled={Boolean(pendingAction)} aria-busy={pendingAction === `going-${item.shiftId}` || undefined} onClick={() => void onCancelGoing(item.shiftId)}>{pendingAction === `going-${item.shiftId}` ? "Cancelling…" : "Cancel Going"}</button>
            </div></details></div>
          </article>;
        })}
      </section>)}
      {!plans.length && !isLoading ? <div className="customer-empty-state"><strong>No plans yet</strong><p>Choose I’m Going on a dancer’s next shift to keep the date, club, and directions here.</p><Link href={homeDiscoveryHref("dancers")}>Find dancers</Link></div> : null}
      {isLoading ? <div className="customer-loading-state">Loading your plans…</div> : null}
    </div>
  </div>;
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
              {group.follows.map((item) => {
                const venue = item.venue;
                const venueId = String(item.venueId || venue?.id || "");
                if (!venue?.slug || !venue.name || !venueId) return null;
                return (
                  <SavedVenueCard
                    key={venueId}
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
  const shift = dancer.nextShift?.status === "posted" && new Date(dancer.nextShift.endsAt).getTime() > Date.now() ? dancer.nextShift : null;
  const shiftLabel = shift ? customerShiftLabel(shift) : "";
  const isWorkingNow = shift?.status === "posted" && shiftLabel === "Working now";
  const statusLabel = isWorkingNow ? "Working now" : "Not working now";
  const statusTone = isWorkingNow ? "working" : shift ? "upcoming" : "quiet";
  const dancerName = String(dancer.stageName || "Dancer");

  return (
    <article className="customer-followed-dancer-card" data-public-dancer-id={dancer.id}>
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
    <details className="customer-card-menu customer-dancer-menu"><summary aria-label={`More options for ${dancerName}`}>•••</summary><div><button
      className="customer-dancer-unfollow"
      type="button"
      aria-label={`Unfollow ${dancerName}`}
      aria-busy={unfollowing || undefined}
      disabled={pending}
      onClick={onUnfollow}
    >
      {unfollowing ? "Unfollowing…" : "Unfollow"}
    </button></div></details>
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
        <details className="customer-card-menu"><summary aria-label={`More options for ${venue.name || "club"}`}>•••</summary><div><button
          className="customer-club-favorite"
          type="button"
          aria-label={`Remove ${venue.name || "club"} from favorites`}
          title="Remove from favorites"
          aria-pressed="true"
          aria-busy={removing || undefined}
          disabled={pending}
          onClick={onUnfollow}
        >
          {removing ? "Removing…" : "Remove favorite"}
        </button></div></details>
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
  onDirections,
  onRemoveSavedDeal,
  pendingAction,
  savedDeals,
}: {
  accountSavedUnavailable: boolean;
  onDirections: (venue: SavedVenueSummary) => void;
  onRemoveSavedDeal: (dealId: string) => void;
  pendingAction: string;
  savedDeals: NonNullable<NonNullable<LoadState["saved"]>["dealSaves"]>;
}) {
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
              <details className="customer-card-menu"><summary aria-label={`Manage saved deal ${item.deal.title || "Club Deal"}`}>•••</summary><div><button
                className="customer-text-action"
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => void onRemoveSavedDeal(item.dealId)}
              >
                Remove
              </button></div></details>
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

    </article>
  );
}


function CustomerPassWallet({ deals, isLoading }: { deals: NonNullable<CustomerSavedState["dealRedemptions"]>; isLoading: boolean }) {
  const now = useCustomerMinuteClock();
  const activeDeals = deals
    .filter((item) => item.status === "generated" && new Date(item.expiresAt).getTime() > now)
    .sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime());
  const pastDeals = deals
    .filter((item) => !activeDeals.some((active) => active.id === item.id))
    .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());

  return <CustomerSurface id="customer-passes" title="Admission passes" description="Open your pass when you arrive at the club." count={activeDeals.length}>
    <div className="customer-pass-list">
      {activeDeals.map(item => <Link className="customer-pass-card" href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`} key={item.id}>
        <div className="customer-pass-icon"><CustomerDashboardIcon section="customer-saved-deals" /></div>
        <div className="customer-pass-copy"><span className="eyebrow">Ready to show</span><h3>{item.deal?.title || "Admission pass"}</h3><p>{item.venue?.name || "Club"}</p><time dateTime={item.expiresAt}>{dealExpiryLabel(item.expiresAt, now)}</time></div>
        <span className="customer-pass-cta">Show pass <span aria-hidden="true">↗</span></span>
      </Link>)}
      {!activeDeals.length && !isLoading ? <div className="customer-empty-state compact"><strong>No active passes</strong><p>Choose a Club Deal to generate an admission pass.</p><Link href={homeDiscoveryHref("venues")}>Explore Club Deals</Link></div> : null}
    </div>
    {activeDeals.length ? <details className="customer-pass-help"><summary>How admission passes work</summary><p>Choose the exact deal and arrival method. Show your pass and its QR code to club staff. Wait for confirmation: staff verifies your arrival method and scans the pass to confirm one admission.</p></details> : null}
    {pastDeals.length ? <details className="past-deal-history"><summary>Past passes <span>{pastDeals.length}</span></summary><div>{pastDeals.map(item => <Link className="customer-past-pass" key={item.id} href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`}><span><strong>{item.deal?.title || "Club Deal"}</strong><small>{item.venue?.name || "Club"}</small></span><span>{dealPassStatus(item.status, new Date(item.expiresAt).getTime() <= now)}</span></Link>)}</div></details> : null}
  </CustomerSurface>;
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
  const [now, setNow] = useState(() => Date.now());
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
