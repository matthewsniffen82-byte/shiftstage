import {
  readSession,
  requestAccountJson,
  requestDashboardJson,
  requestOptionalDashboardJson,
  storedSessionIsFresh,
} from "./dashboard-session.ts";

type DancerPanel = "ready" | "supportThreads" | "reviews" | "weeklyReport" | "rankingEvents" | "agentAccess";

export async function loadDancerDashboard(
  signal: AbortSignal,
  publish: (panel: DancerPanel, data: any) => void,
) {
  const update = (panel: DancerPanel, data: any) => {
    if (!signal.aborted) publish(panel, data);
  };
  const session = readSession();
  const accountRequest = requestAccountJson({ cache: "no-store", signal, timeoutMs: 15000 });
  // Refresh an expiring session once before starting concurrent requests.
  if (!storedSessionIsFresh(session)) await accountRequest;
  if (signal.aborted) return;

  const loadProfile = async () => {
    // Finalize any saved first tap before reading the profile. Otherwise an
    // activated dancer could briefly be sent back through onboarding.
    const secondary = await requestDashboardJson("/api/dancer/dashboard", {
      cache: "no-store", signal, timeoutMs: 15000,
    });
    if (signal.aborted) return null;
    const profile = await requestDashboardJson("/api/dancer/profile", {
      cache: "no-store", signal, timeoutMs: 15000,
    });
    return {
      profile: profile.profile,
      analytics: secondary.analytics || null,
      deals: secondary.deals || null,
      finance: secondary.finance || null,
      affiliations: secondary.affiliations || [],
      nfc: secondary.nfc || null,
    };
  };
  const optional = async (path: string, panel: DancerPanel, key: string) => {
    const data = await requestOptionalDashboardJson(path, {}, { signal, timeoutMs: 8000 });
    update(panel, data[key] ?? null);
  };

  // Keep active-account loading concurrent. A paused account's settings must
  // not depend on an active-only request succeeding (or reaching its deadline).
  const profileRequest = loadProfile().then(
    profile => ({ ok: true as const, profile }),
    error => ({ ok: false as const, error }),
  );
  await Promise.all([
    accountRequest.then(async ({ account }) => {
      if (account?.role === "dancer" && account.accountState === "disabled") {
        update("ready", {
          account, profile: null, analytics: null, deals: null, finance: null,
          affiliations: [], nfc: null, agentAccess: null,
        });
        return;
      }
      const result = await profileRequest;
      if (!result.ok) throw result.error;
      if (result.profile) update("ready", { account, ...result.profile });
    }),
    // These results can arrive independently of the dashboard's identity,
    // activation and payout state. They must not delay opening its controls.
    optional("/api/support", "supportThreads", "threads"),
    optional("/api/dancer/reviews", "reviews", "reviews"),
    optional("/api/dancer/weekly-report", "weeklyReport", "report"),
    optional("/api/dancer/ranking-events", "rankingEvents", "events"),
    optional("/api/agent/commissions?access=1", "agentAccess", "access"),
  ]);
}
