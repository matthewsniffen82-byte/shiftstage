export type CustomerDashboardSectionId = "customer-followed-dancers" | "customer-followed-clubs" | "customer-saved-deals" | "customer-going" | "customer-alerts" | "customer-account";

export function CustomerDashboardIcon({ section }: { section: CustomerDashboardSectionId }) {
  const paths: Record<CustomerDashboardSectionId, string> = {
    "customer-followed-dancers": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9",
    "customer-followed-clubs": "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
    "customer-saved-deals": "M9 3h6v18H9M5 3h14a2 2 0 0 1 2 2v4a3 3 0 0 0 0 6v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a3 3 0 0 0 0-6V5a2 2 0 0 1 2-2Z",
    "customer-going": "M7 3v4M17 3v4M4 10h16M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 15l3 3 5-5",
    "customer-alerts": "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    "customer-account": "M12 3 4.5 6v5.5c0 4.2 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.3 7.5-9.5V6L12 3Zm-3.5 9 2.3 2.3 4.7-4.7",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]} /></svg>;
}

export function CustomerDashboardAvatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || "").join("").toLocaleUpperCase();
  return <span className="customer-dashboard-avatar" aria-hidden="true">{initials || "M"}</span>;
}
