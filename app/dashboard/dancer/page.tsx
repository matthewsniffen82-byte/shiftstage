import DashboardClient from "../DashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function DancerDashboardPage() {
  return <DashboardClient role="dancer" />;
}
