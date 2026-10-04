"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DancerDashboardIcon } from "./DancerDashboardIdentity";

const destinations = [
  { id: "overview", label: "Overview", icon: "status" },
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "results", label: "Results", icon: "performance" },
  { id: "account", label: "Account", icon: "account" },
] as const;
type Destination = typeof destinations[number]["id"];

export function dancerDashboardDestination(hash: string): Destination {
  if (/profile|media|share|visibility/.test(hash)) return "profile";
  if (/performance|results/.test(hash)) return "results";
  if (/account|support|notification|connected|verification|nfc/.test(hash)) return "account";
  return "overview";
}

export default function DancerDashboardWorkspace({ overview, profile, results, account, busy = false, editorRequested = 0, previewRequested = 0 }: {
  overview: ReactNode; profile: ReactNode; results: ReactNode; account: ReactNode;
  busy?: boolean; editorRequested?: number; previewRequested?: number;
}) {
  const [active, setActive] = useState<Destination>("overview");
  const [visited, setVisited] = useState<Destination[]>(["overview"]);
  const panel = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const busyRef = useRef(busy);
  activeRef.current = active;
  busyRef.current = busy;
  const content = { overview, profile, results, account };
  const select = (id: Destination) => {
    if (busyRef.current) return;
    setVisited(current => current.includes(id) ? current : [...current, id]);
    setActive(id);
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
        if (target instanceof HTMLDetailsElement) target.open = true;
      });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!editorRequested && !previewRequested) return;
    select("profile");
    window.history.replaceState(null, "", "#dancer-profile");
  }, [editorRequested, previewRequested]);
  return <div className="dancer-dashboard-workspace">
    <nav className="dancer-dashboard-nav" aria-label="Dancer dashboard">
      {destinations.map(item => <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} aria-controls={`dancer-destination-${item.id}`} disabled={busy} onClick={() => {
        select(item.id);
        window.history.replaceState(null, "", `#dancer-${item.id}`);
        window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`#dancer-destination-${item.id}`)?.focus({ preventScroll: true }));
      }}><DancerDashboardIcon section={item.icon} /><span>{item.label}</span></button>)}
    </nav>
    <div ref={panel} className="dancer-dashboard-destinations">
      {destinations.map(item => <section key={item.id} id={`dancer-destination-${item.id}`} hidden={active !== item.id} aria-label={item.label} tabIndex={-1}>
        {visited.includes(item.id) ? content[item.id] : null}
      </section>)}
    </div>
  </div>;
}
