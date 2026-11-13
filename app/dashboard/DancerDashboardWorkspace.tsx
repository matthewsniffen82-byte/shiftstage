"use client";
import { DashboardHelpArea } from "../components/dashboard-help-scope";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DancerDashboardIcon } from "./DancerDashboardIdentity";
import "./dancer-account.css";

const destinations = [
  { id: "overview", label: "Overview", icon: "status" },
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "results", label: "Results", icon: "performance" },
  { id: "account", label: "Account", icon: "account" },
] as const;
export type Destination = typeof destinations[number]["id"];

export function dancerDashboardDestination(hash: string): Destination {
  if (/profile|media|photo|video|details|share|visibility/.test(hash)) return "profile";
  if (/performance|results/.test(hash)) return "results";
  if (/account|support|notification|connected|verification|nfc/.test(hash)) return "account";
  return "overview";
}

export default function DancerDashboardWorkspace({ overview, profile, results, account, busy = false, onResultsOpen, onDestinationChange }: {
  overview: ReactNode; profile: ReactNode | ((active: boolean) => ReactNode); results: ReactNode; account: ReactNode;
  busy?: boolean; onResultsOpen?: () => void; onDestinationChange?: (id: Destination) => void;
}) {
  const [active, setActive] = useState<Destination>("overview");
  const [visited, setVisited] = useState<Destination[]>(["overview"]);
  const panel = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const activeRef = useRef(active);
  const busyRef = useRef(busy);
  const onResultsOpenRef = useRef(onResultsOpen);
  const onDestinationChangeRef = useRef(onDestinationChange);
  activeRef.current = active;
  busyRef.current = busy;
  onResultsOpenRef.current = onResultsOpen;
  onDestinationChangeRef.current = onDestinationChange;
  useEffect(() => {
    const nav = navigation.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const measure = () => nav.parentElement?.style.setProperty("--dancer-dashboard-nav-height", `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  const content = { overview, profile: typeof profile === "function" ? profile(active === "profile") : profile, results, account };
  const select = (id: Destination) => {
    if (busyRef.current) return;
    setVisited(current => current.includes(id) ? current : [...current, id]);
    setActive(id);
    onDestinationChangeRef.current?.(id);
    if (id === "results") onResultsOpenRef.current?.();
  };
  useEffect(() => {
    const sync = () => {
      if (busyRef.current) {
        window.history.replaceState(null, "", `#dancer-${activeRef.current}`);
        return;
      }
      select(dancerDashboardDestination(window.location.hash));
      const targetId = window.location.hash.slice(1);
      window.requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        for (let section = target?.closest("details"); section; section = section.parentElement?.closest("details")) {
          section.open = true;
        }
        if (target && targetId !== `dancer-${activeRef.current}`) target.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return <div className="dancer-dashboard-workspace">
    <nav ref={navigation} className="dancer-dashboard-nav" aria-label="Dancer dashboard" aria-describedby={busy ? "dancer-navigation-busy" : undefined}>
      {destinations.map(item => <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} aria-controls={`dancer-destination-${item.id}`} disabled={busy} onClick={() => {
        if (busyRef.current) return;
        select(item.id);
        window.history.replaceState(null, "", `#dancer-${item.id}`);
        window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`#dancer-destination-${item.id}`)?.focus({ preventScroll: true }));
      }}><DancerDashboardIcon section={item.icon} /><span>{item.label}</span></button>)}
    </nav>
    {busy ? <p id="dancer-navigation-busy" role="status">Finish the current action before switching dashboard sections.</p> : null}
    <div ref={panel} className="dancer-dashboard-destinations">
      {destinations.map(item => <section key={item.id} id={`dancer-destination-${item.id}`} hidden={active !== item.id} aria-label={item.label} tabIndex={-1}>
        <DashboardHelpArea context={`dancer-${item.id}`} active={active === item.id}>{visited.includes(item.id) ? content[item.id] : null}</DashboardHelpArea>
      </section>)}
    </div>
  </div>;
}
