export type CustomerView = "night" | "saved" | "alerts" | "account";
export type CustomerSavedFilter = "dancers" | "clubs" | "deals";

export function customerDashboardDestination(hash: string, initialSection?: string): { view: CustomerView; filter: CustomerSavedFilter } {
  const id = hash.replace(/^#/, "");
  if (id.startsWith("customer-alert") || id === "customer-notification-preferences") return { view: "alerts", filter: "dancers" };
  if (id.startsWith("customer-account") || id.startsWith("customer-support")) return { view: "account", filter: "dancers" };
  if (id === "customer-followed-clubs") return { view: "saved", filter: "clubs" };
  if (id === "customer-saved-deals") return { view: "saved", filter: "deals" };
  if (id === "customer-saved" || id === "customer-followed-dancers") return { view: "saved", filter: "dancers" };
  if (!id && initialSection) return { view: "saved", filter: initialSection === "offers" ? "deals" : "dancers" };
  return { view: "night", filter: "dancers" };
}
