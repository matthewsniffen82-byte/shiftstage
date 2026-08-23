import { redirect } from "next/navigation";

export default async function ClubJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const params = await searchParams;
  const agent = Array.isArray(params.agent) ? params.agent[0] : params.agent;
  const referral = typeof agent === "string" ? agent.trim().toLowerCase() : "";
  redirect(referral
    ? `/?venueRequest=1&agent=${encodeURIComponent(referral.slice(0, 128))}`
    : "/?venueRequest=1");
}
