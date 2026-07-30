import { permanentRedirect } from "next/navigation";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type TrendingPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function TrendingPage({ searchParams }: TrendingPageProps) {
  const params = await searchParams;
  permanentRedirect(homeDiscoveryHref("trending", params.city));
}
