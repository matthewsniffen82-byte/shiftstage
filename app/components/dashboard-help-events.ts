export const OPEN_DASHBOARD_HELP = "dancr:open-dashboard-help";
export const DASHBOARD_HELP_UPDATED = "dancr:dashboard-help-updated";
export type HelpView = "assistant" | "messages";
export function openDashboardHelp(accountId: string, view: HelpView = "messages") {
  if (accountId) window.dispatchEvent(new CustomEvent(OPEN_DASHBOARD_HELP, { detail: { accountId, view } }));
}
