type VenueIcon = "tonight" | "venue" | "business" | "deals" | "roster" | "stickers" | "analytics" | "tv" | "team" | "account";

export function VenueDashboardIcon({ section }: { section: VenueIcon }) {
  const paths: Record<VenueIcon, string> = {
    tonight: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
    venue: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h1M14 9h1",
    business: "M3 7h18v14H3ZM8 7V3h8v4M3 12h18M10 12v3h4v-3",
    deals: "M9 3h6v18H9M5 3h14a2 2 0 0 1 2 2v4a3 3 0 0 0 0 6v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a3 3 0 0 0 0-6V5a2 2 0 0 1 2-2Z",
    roster: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 10l2 2 4-4",
    stickers: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h2v2h-2ZM20 14v6h-6v-2",
    analytics: "M4 3v18h17M8 16v-4M13 16V8M18 16V5",
    tv: "M3 5h18v14H3ZM10 9l5 3-5 3Z",
    team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9",
    account: "M12 3 4.5 6v5.5c0 4.2 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.3 7.5-9.5V6L12 3Zm-3.5 9 2.3 2.3 4.7-4.7",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]} /></svg>;
}
