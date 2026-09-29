import "../../internal/internal.css";
import "../../internal/internal-dashboard.css";
import DashboardClient from "../DashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function VenueDashboardPage() {
  return <DashboardClient role="venue" />;
}
