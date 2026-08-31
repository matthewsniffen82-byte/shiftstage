import DashboardClient from "../DashboardClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CustomerDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  return <DashboardClient role="customer" showCustomerWelcome={params.confirmed === "1"} />;
}
