import AgentDashboardClient from "./AgentDashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AgentDashboardPage() {
  return <AgentDashboardClient />;
}
