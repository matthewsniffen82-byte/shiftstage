import { InternalRoster } from "../../InternalRoster";
export default async function Page({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  return <InternalRoster token={token} fromClubDashboard={query.from === "club-dashboard"} />;
}
