import {
  dashboardLoadErrorMessage,
  requestAccountJson,
  requestDashboardJson,
  requestOptionalDashboardJson,
} from "./dashboard-session.ts";

type CustomerPanel = "account" | "saved" | "savedError" | "profile" | "support" | "agentAccess";

// Publish each result as it arrives. Support and referral access must never
// hold the guest's account and followed profiles behind a full-page skeleton.
export async function loadCustomerDashboard(
  signal: AbortSignal,
  publish: (panel: CustomerPanel, data: any) => void,
) {
  const update = (panel: CustomerPanel, data: any) => {
    if (!signal.aborted) publish(panel, data);
  };
  // Refresh credentials once before starting the independent panel requests.
  const account = await requestAccountJson({ cache: "no-store", signal, timeoutMs: 15000 });
  if (signal.aborted) return;
  update("account", account.account);

  const optional = async (path: string, panel: CustomerPanel, key: string) => {
    const data = await requestOptionalDashboardJson(path, {}, { signal, timeoutMs: 8000 });
    update(panel, data[key] ?? null);
  };
  await Promise.all([
    requestDashboardJson("/api/customer/saved", {
      cache: "no-store", signal, timeoutMs: 15000,
      fallbackMessage: "Unable to load your saved activity. Please try again.",
    }).then((data) => update("saved", data.saved)).catch((error) => {
      update("savedError", dashboardLoadErrorMessage(error));
    }),
    optional("/api/customer/profile", "profile", "profile"),
    optional("/api/support", "support", "threads"),
    optional("/api/agent/commissions?access=1", "agentAccess", "access"),
  ]);
}
