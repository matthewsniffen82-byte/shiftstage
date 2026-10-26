import VenueTeamInviteClient from "./VenueTeamInviteClient";
import { Inter, Space_Grotesk } from "next/font/google";

const invitationUi = Inter({ subsets: ["latin"], display: "swap", variable: "--font-ui" });
const invitationDisplay = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-display" });

export const dynamic = "force-dynamic";

export default async function VenueTeamInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <div className={`${invitationUi.variable} ${invitationDisplay.variable}`}><VenueTeamInviteClient token={token} /></div>;
}
