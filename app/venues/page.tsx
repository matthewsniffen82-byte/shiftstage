import { permanentRedirect } from "next/navigation";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type VenuesPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function VenuesPage({ searchParams }: VenuesPageProps) {
  const params = await searchParams;
  permanentRedirect(homeDiscoveryHref("venues", params.city));
}
