import type { SupabaseClient } from "@supabase/supabase-js";
import { getNatsRuntimeConfig } from "./nats";

type DancrClient = SupabaseClient;

function getPublicNatsRuntimeConfig() {
  const config = getNatsRuntimeConfig();
  return {
    settlementProvider: config.settlementProvider,
    selected: config.selected,
    configured: config.configured,
    affiliatePortalUrl: config.affiliatePortalUrl,
  };
}

export const AGENT_COMMISSION_POLICY = Object.freeze({
  direct: { level: 0, shareBps: 1500 },
  sponsorLevels: [
    { level: 1, shareBps: 300 },
    { level: 2, shareBps: 250 },
    { level: 3, shareBps: 200 },
    { level: 4, shareBps: 150, foundingOnly: true },
    { level: 5, shareBps: 100, foundingOnly: true },
  ],
  standardDepth: 3,
  foundingDepth: 5,
  maximumCombinedShareBps: 7450,
  minimumMydancrShareBps: 2550,
  version: "sales-agent-v1",
});

export type SetSalesAgentInput = {
  adminUserId: string;
  userId: string;
  sponsorAgentId?: string | null;
  commissionDepthLimit: 3 | 5;
  status: "active" | "suspended" | "terminated";
};

export async function setAdminSalesAgent(client: DancrClient, input: SetSalesAgentInput) {
  if (!input.adminUserId || !input.userId) throw new Error("Admin and account are required.");
  if (![3, 5].includes(input.commissionDepthLimit)) throw new Error("Agent depth must be three or five levels.");
  const { data, error } = await (client as any).rpc("set_admin_sales_agent", {
    p_admin_id: input.adminUserId,
    p_user_id: input.userId,
    p_sponsor_agent_id: input.sponsorAgentId || null,
    p_commission_depth_limit: input.commissionDepthLimit,
    p_status: input.status,
  });
  if (error) throw error;
  return data as string;
}

export async function assignAdminVenueSalesAgent(client: DancrClient, input: {
  adminUserId: string;
  venueId: string;
  signingAgentId: string;
  agreementReference: string;
  effectiveFrom?: string;
}) {
  const reference = input.agreementReference.trim();
  if (!input.adminUserId || !input.venueId || !input.signingAgentId) {
    throw new Error("Admin, venue, and signing agent are required.");
  }
  if (reference.length < 3 || reference.length > 180) {
    throw new Error("A signed venue agreement reference is required.");
  }
  const { data, error } = await (client as any).rpc("assign_admin_venue_sales_agent", {
    p_admin_id: input.adminUserId,
    p_venue_id: input.venueId,
    p_signing_agent_id: input.signingAgentId,
    p_agreement_reference: reference,
    p_effective_from: input.effectiveFrom || new Date().toISOString(),
  });
  if (error) throw error;
  return data as string;
}

export async function getAdminSalesAgentProgram(client: DancrClient) {
  const [agentsResult, usersResult, venuesResult, attributionsResult, commissionsResult,
    natsAccountsResult, natsExportsResult] = await Promise.all([
    (client as any).from("sales_agents").select("id, user_id, sponsor_agent_id, status, commission_depth_limit, referral_code, created_at, updated_at").order("created_at").limit(500),
    (client as any).from("app_users").select("id, display_name, email, role, account_state").eq("account_state", "active").order("display_name").limit(1000),
    (client as any).from("venues").select("id, name, city, state, is_active").eq("is_active", true).order("name").limit(1000),
    (client as any).from("venue_sales_attributions").select("id, venue_id, signing_agent_id, sponsor_level_1_agent_id, sponsor_level_2_agent_id, sponsor_level_3_agent_id, sponsor_level_4_agent_id, sponsor_level_5_agent_id, agreement_reference, effective_from, superseded_at, created_at").order("effective_from", { ascending: false }).limit(1000),
    (client as any).from("agent_commission_events").select("id, deal_revenue_event_id, venue_id, recipient_agent_id, signing_agent_id, sponsor_level, share_bps, amount_cents, currency, status, commission_month, venue_payment_received_at, payable_at, paid_at, payout_reference, created_at").order("created_at", { ascending: false }).limit(5000),
    (client as any).from("nats_agent_affiliate_accounts").select("agent_id, login_id, username, status, requested_at, activated_at, disabled_at, verification_note, last_error, updated_at").order("requested_at", { ascending: false }).limit(1000),
    (client as any).from("nats_agent_commission_exports").select("id, agent_commission_event_id, agent_id, amount_cents, currency, status, attempt_count, exported_at, failed_at, reconciled_at, nats_result, last_error, created_at").order("created_at", { ascending: false }).limit(5000),
  ]);
  for (const result of [agentsResult, usersResult, venuesResult, attributionsResult, commissionsResult, natsAccountsResult, natsExportsResult]) {
    if (result.error) throw result.error;
  }
  const users = usersResult.data || [];
  const userById = new Map(users.map((row: any) => [row.id, row]));
  const agents = (agentsResult.data || []).map((row: any) => ({ ...row, account: userById.get(row.user_id) || null }));
  const agentById = new Map(agents.map((row: any) => [row.id, row]));
  const venues = venuesResult.data || [];
  const venueById = new Map(venues.map((row: any) => [row.id, row]));
  const commissions = (commissionsResult.data || []).map((row: any) => ({
    ...row, venue: venueById.get(row.venue_id) || null, recipientAgent: agentById.get(row.recipient_agent_id) || null,
  }));
  const attributions = (attributionsResult.data || []).map((row: any) => ({
    ...row, venue: venueById.get(row.venue_id) || null, signingAgent: agentById.get(row.signing_agent_id) || null,
  }));
  const sum = (status: string) => commissions.filter((row: any) => row.status === status)
    .reduce((total: number, row: any) => total + Number(row.amount_cents || 0), 0);
  return {
    policy: AGENT_COMMISSION_POLICY,
    nats: getPublicNatsRuntimeConfig(),
    metrics: {
      activeAgents: agents.filter((row: any) => row.status === "active").length,
      foundingAgents: agents.filter((row: any) => row.status === "active" && row.commission_depth_limit === 5).length,
      attributedVenues: attributions.filter((row: any) => !row.superseded_at).length,
      pendingVenuePaymentCents: sum("pending_venue_payment"),
      payableCents: sum("payable"), paidCents: sum("paid"),
      natsRequestedCount: (natsAccountsResult.data || []).filter((row: any) => row.status === "requested").length,
      natsReconciliationCount: (natsExportsResult.data || []).filter((row: any) => row.status === "reconciliation_required").length,
    },
    agents, accountCandidates: users, venues, attributions, commissions,
    natsAccounts: natsAccountsResult.data || [], natsExports: natsExportsResult.data || [],
  };
}

export async function getAgentCommissionDashboard(client: DancrClient, userId: string) {
  const { data: agent, error: agentError } = await (client as any).from("sales_agents")
    .select("id, user_id, status, commission_depth_limit, referral_code").eq("user_id", userId).maybeSingle();
  if (agentError) throw agentError;
  if (!agent || agent.status !== "active") throw new Error("Active sales agent access required.");
  const [accountResult, commissionsResult, attributionsResult, referralRequestsResult, natsAccountResult, natsExportsResult] = await Promise.all([
    (client as any).from("app_users").select("display_name, email").eq("id", userId).maybeSingle(),
    (client as any).from("agent_commission_events").select("id, venue_id, sponsor_level, share_bps, amount_cents, currency, status, commission_month, venue_payment_received_at, payable_at, paid_at, payout_reference, created_at, venues(name)").eq("recipient_agent_id", agent.id).order("created_at", { ascending: false }).limit(5000),
    (client as any).from("venue_sales_attributions").select("id, venue_id, agreement_reference, effective_from, superseded_at, venues(name, city, state, is_active, published_at)").eq("signing_agent_id", agent.id).order("effective_from", { ascending: false }).limit(500),
    (client as any).from("venue_signup_requests").select("id, venue_name, city, state, status, matched_venue_id, submitted_at, reviewed_at, venue:venues!venue_signup_requests_matched_venue_id_fkey(name, slug, is_active, published_at)").eq("referring_agent_id", agent.id).order("submitted_at", { ascending: false }).limit(500),
    (client as any).from("nats_agent_affiliate_accounts").select("agent_id, login_id, username, status, requested_at, activated_at, last_error").eq("agent_id", agent.id).maybeSingle(),
    (client as any).from("nats_agent_commission_exports").select("id, agent_commission_event_id, amount_cents, currency, status, attempt_count, exported_at, last_error, created_at").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(500),
  ]);
  for (const result of [accountResult, commissionsResult, attributionsResult, referralRequestsResult, natsAccountResult, natsExportsResult]) {
    if (result.error) throw result.error;
  }
  const rows = commissionsResult.data || [];
  const total = (status: string) => rows.filter((row: any) => row.status === status)
    .reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
  const referrals = referralRequestsResult.data || [];
  const activeAttributions = (attributionsResult.data || []).filter((row: any) => !row.superseded_at);
  return {
    agent: { id: agent.id, displayName: accountResult.data?.display_name || accountResult.data?.email || "Sales agent",
      email: accountResult.data?.email || null, commissionDepthLimit: agent.commission_depth_limit,
      designation: agent.commission_depth_limit === 5 ? "Founding Agent" : "Sales Agent" },
    referralUrl: `${publicAppUrl()}/clubs/join?agent=${encodeURIComponent(agent.referral_code)}`,
    policy: AGENT_COMMISSION_POLICY, nats: getPublicNatsRuntimeConfig(), natsAccount: natsAccountResult.data,
    natsExports: natsExportsResult.data || [],
    metrics: { pendingVenuePaymentCents: total("pending_venue_payment"), payableCents: total("payable"),
      paidCents: total("paid"), signedVenueCount: activeAttributions.length,
      referredVenueCount: referrals.length,
      pendingReferralCount: referrals.filter((row: any) => row.status === "pending").length,
      approvedReferralCount: referrals.filter((row: any) => row.status === "approved").length,
      liveReferredVenueCount: referrals.filter((row: any) => firstJoined(row.venue)?.is_active === true).length },
    commissions: rows, signedVenues: attributionsResult.data || [], referralRequests: referrals,
  };
}

export function agentStatementCsv(dashboard: Awaited<ReturnType<typeof getAgentCommissionDashboard>>) {
  const rows: Array<Array<unknown>> = [["Date", "Agent", "Venue", "Commission type", "Rate", "Amount", "Status", "Paid", "Payout reference"]];
  for (const event of dashboard.commissions as any[]) rows.push([
    event.created_at, dashboard.agent.displayName, firstJoined(event.venues)?.name || "Venue",
    event.sponsor_level === 0 ? "Direct venue signer" : `Sponsor level ${event.sponsor_level}`,
    `${Number(event.share_bps || 0) / 100}%`, (Number(event.amount_cents || 0) / 100).toFixed(2),
    event.status, event.paid_at || "", event.payout_reference || "",
  ]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function firstJoined(value: any) { return Array.isArray(value) ? value[0] || null : value || null; }

function publicAppUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.DANCR_PUBLIC_URL || "https://mydancr.com";
  return configured.replace(/\/$/, "");
}
