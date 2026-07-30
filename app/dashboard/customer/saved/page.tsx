import DashboardClient from "../../DashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CustomerSavedPage() {
  return <DashboardClient role="customer" initialSection="saved" />;
}
