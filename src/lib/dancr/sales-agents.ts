import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

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
  version: "sales-agent-v1",
});

export type SetSalesAgentInput = {
  adminUserId: string;
  userId: string;
  sponsorAgentId?: string | null;
  commissionDepthLimit: 3 | 5;
  status: "active" | "suspended" | "terminated";
};

export type AssignVenueSalesAgentInput = {
  adminUserId: string;
  venueId: string;
  signingAgentId: string;
  agreementReference: string;
  effectiveFrom?: string;
};

export async function getAdminSalesAgentProgram(client: DancrClient) {
  const [agentsResult, accountsResult, venuesResult, attributionsResult, commissionsResult] = await Promise.all([
    (client as any).from("sales_agents")
      .select("id, user_id, sponsor_agent_id, status, commission_depth_limit, created_at, updated_at")
      .order("created_at", { ascending: true }).limit(500),
    (client as any).from("app_users")
      .select("id, display_name, email, role, account_state")
      .eq("account_state", "active").order("display_name", { ascending: true }).limit(1000),
    (client as any).from("venues")
      .select("id, name, city, state, is_active")
      .eq("is_active", true).order("name", { ascending: true }).limit(1000),
    (client as any).from("venue_sales_attributions")
      .select("id, venue_id, signing_agent_id, sponsor_level_1_agent_id, sponsor_level_2_agent_id, sponsor_level_3_agent_id, sponsor_level_4_agent_id, sponsor_level_5_agent_id, agreement_reference, effective_from, superseded_at, created_at")
      .order("effective_from", { ascending: false }).limit(1000),
    (client as any).from("agent_commission_events")
      .select("id, deal_revenue_event_id, venue_id, recipient_agent_id, signing_agent_id, sponsor_level, share_bps, amount_cents, currency, status, commission_month, paid_at, payout_reference, created_at")
      .order("created_at", { ascending: false }).limit(5000),
  ]);

  for (const result of [agentsResult, accountsResult, venuesResult, attributionsResult, commissionsResult]) {
    if (result.error) throw result.error;
  }

  const accounts = accountsResult.data || [];
  const accountById = new Map(accounts.map((account: any) => [account.id, account]));
  const agents = (agentsResult.data || []).map((agent: any) => ({
    ...agent,
    account: accountById.get(agent.user_id) || null,
  }));
  const agentById = new Map(agents.map((agent: any) => [agent.id, agent]));
  const venues = venuesResult.data || [];
  const venueById = new Map(venues.map((venue: any) => [venue.id, venue]));
  const attributions = (attributionsResult.data || []).map((attribution: any) => ({
    ...attribution,
    venue: venueById.get(attribution.venue_id) || null,
    signingAgent: agentById.get(attribution.signing_agent_id) || null,
  }));
  const commissions = (commissionsResult.data || []).map((commission: any) => ({
    ...commission,
    venue: venueById.get(commission.venue_id) || null,
    recipientAgent: agentById.get(commission.recipient_agent_id) || null,
  }));
  const sum = (status: string) => commissions
    .filter((commission: any) => commission.status === status)
    .reduce((total: number, commission: any) => total + Number(commission.amount_cents || 0), 0);

  return {
    policy: AGENT_COMMISSION_POLICY,
    metrics: {
      activeAgents: agents.filter((agent: any) => agent.status === "active").length,
      foundingAgents: agents.filter((agent: any) => agent.status === "active" && agent.commission_depth_limit === 5).length,
      attributedVenues: attributions.filter((attribution: any) => !attribution.superseded_at).length,
      pendingVenuePaymentCents: sum("pending_venue_payment"),
      payableCents: sum("payable"),
      paidCents: sum("paid"),
    },
    agents,
    accountCandidates: accounts,
    venues,
    attributions,
    commissions,
  };
}

export async function setAdminSalesAgent(client: DancrClient, input: SetSalesAgentInput) {
  if (!input.adminUserId || !input.userId) throw new Error("Admin and account are required.");
  if (![3, 5].includes(input.commissionDepthLimit)) throw new Error("Agent depth must be three or five levels.");
  if (!["active", "suspended", "terminated"].includes(input.status)) throw new Error("Agent status is invalid.");
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

export async function assignAdminVenueSalesAgent(client: DancrClient, input: AssignVenueSalesAgentInput) {
  const agreementReference = input.agreementReference.trim();
  if (!input.adminUserId || !input.venueId || !input.signingAgentId) {
    throw new Error("Admin, venue, and signing agent are required.");
  }
  if (agreementReference.length < 3 || agreementReference.length > 180) {
    throw new Error("A signed venue agreement reference is required.");
  }
  const { data, error } = await (client as any).rpc("assign_admin_venue_sales_agent", {
    p_admin_id: input.adminUserId,
    p_venue_id: input.venueId,
    p_signing_agent_id: input.signingAgentId,
    p_agreement_reference: agreementReference,
    p_effective_from: input.effectiveFrom || new Date().toISOString(),
  });
  if (error) throw error;
  return data as string;
}

export async function recordAdminAgentCommissionPayment(
  client: DancrClient,
  input: { adminUserId: string; commissionEventId: string; payoutReference: string },
) {
  const payoutReference = input.payoutReference.trim();
  if (!input.adminUserId || !input.commissionEventId) throw new Error("Admin and commission are required.");
  if (payoutReference.length < 3 || payoutReference.length > 180) {
    throw new Error("A valid agent payout reference is required.");
  }
  const { data, error } = await (client as any).rpc("record_admin_agent_commission_payment", {
    p_admin_id: input.adminUserId,
    p_agent_commission_event_id: input.commissionEventId,
    p_payout_reference: payoutReference,
    p_paid_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

export async function getAgentCommissionDashboard(client: DancrClient, userId: string) {
  const { data: agent, error: agentError } = await (client as any).from("sales_agents")
    .select("id, user_id, sponsor_agent_id, status, commission_depth_limit, created_at")
    .eq("user_id", userId).maybeSingle();
  if (agentError) throw agentError;
  if (!agent || agent.status !== "active") throw new Error("Active sales agent access required.");

  const [{ data: account, error: accountError }, { data: commissions, error: commissionsError }, { data: attributions, error: attributionsError }] = await Promise.all([
    (client as any).from("app_users").select("display_name, email").eq("id", userId).maybeSingle(),
    (client as any).from("agent_commission_events")
      .select("id, venue_id, sponsor_level, share_bps, amount_cents, currency, status, commission_month, venue_payment_received_at, payable_at, paid_at, payout_reference, created_at, venues(name)")
      .eq("recipient_agent_id", agent.id).order("created_at", { ascending: false }).limit(5000),
    (client as any).from("venue_sales_attributions")
      .select("id, venue_id, agreement_reference, effective_from, superseded_at, venues(name)")
      .eq("signing_agent_id", agent.id).order("effective_from", { ascending: false }).limit(500),
  ]);
  if (accountError) throw accountError;
  if (commissionsError) throw commissionsError;
  if (attributionsError) throw attributionsError;

  const rows = commissions || [];
  const total = (status: string) => rows.filter((row: any) => row.status === status)
    .reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
  return {
    agent: {
      id: agent.id,
      displayName: account?.display_name || account?.email || "Sales agent",
      email: account?.email || null,
      commissionDepthLimit: agent.commission_depth_limit,
      designation: agent.commission_depth_limit === 5 ? "Founding Agent" : "Sales Agent",
    },
    policy: AGENT_COMMISSION_POLICY,
    metrics: {
      pendingVenuePaymentCents: total("pending_venue_payment"),
      payableCents: total("payable"),
      paidCents: total("paid"),
      signedVenueCount: (attributions || []).filter((row: any) => !row.superseded_at).length,
    },
    commissions: rows,
    signedVenues: attributions || [],
  };
}

export function agentStatementCsv(dashboard: Awaited<ReturnType<typeof getAgentCommissionDashboard>>) {
  const rows: Array<Array<unknown>> = [[
    "Date", "Agent", "Venue", "Commission type", "Rate", "Amount", "Status", "Paid", "Payout reference",
  ]];
  for (const event of dashboard.commissions as any[]) {
    rows.push([
      event.created_at,
      dashboard.agent.displayName,
      firstJoined(event.venues)?.name || "Venue",
      event.sponsor_level === 0 ? "Direct venue signer" : `Sponsor level ${event.sponsor_level}`,
      `${Number(event.share_bps || 0) / 100}%`,
      (Number(event.amount_cents || 0) / 100).toFixed(2),
      event.status,
      event.paid_at || "",
      event.payout_reference || "",
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function firstJoined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}
