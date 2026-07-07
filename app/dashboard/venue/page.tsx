import DashboardClient from "../DashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function VenueDashboardPage() {
  return <DashboardClient role="venue" />;
}
