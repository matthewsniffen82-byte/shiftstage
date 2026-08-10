import VenueTeamInviteClient from "./VenueTeamInviteClient";

export const dynamic = "force-dynamic";

export default async function VenueTeamInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <VenueTeamInviteClient token={token} />;
}
