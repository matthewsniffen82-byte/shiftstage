import { permanentRedirect } from "next/navigation";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type DancersPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function DancersPage({ searchParams }: DancersPageProps) {
  const params = await searchParams;
  permanentRedirect(homeDiscoveryHref("dancers", params.city));
}
