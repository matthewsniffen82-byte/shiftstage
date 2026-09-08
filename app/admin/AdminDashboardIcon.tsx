type AdminIcon = "home" | "approvals" | "people" | "clubs" | "money" | "more" | "shield" | "panel" | "chevron";

const paths: Record<AdminIcon, string> = {
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  approvals: "M9 4H5v17h14V4h-4M9 3h6v4H9V3Zm-1 11 3 3 5-6",
  people: "M16 21v-2a5 5 0 0 0-10 0v2M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 4a4 4 0 0 1 0 7M21 21v-2a5 5 0 0 0-3-4.6",
  clubs: "M4 21V8l8-5 8 5v13H4ZM9 21v-6h6v6M8 10h1M15 10h1",
  money: "M3 6h18v14H3V6Zm0 4h18M15 15h3M6 3h12",
  more: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4",
  shield: "M12 3 4.5 6v5.5c0 4.2 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.3 7.5-9.5V6L12 3Zm-3.5 9 2.3 2.3 4.7-4.7",
  panel: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  chevron: "m6 9 6 6 6-6",
};

export function AdminDashboardIcon({ section }: { section: AdminIcon }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]} /></svg>;
}
