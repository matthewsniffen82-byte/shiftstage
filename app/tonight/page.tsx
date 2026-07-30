import { permanentRedirect } from "next/navigation";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type TonightPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function TonightPage({ searchParams }: TonightPageProps) {
  const params = await searchParams;
  permanentRedirect(homeDiscoveryHref("tonight", params.city));
}
