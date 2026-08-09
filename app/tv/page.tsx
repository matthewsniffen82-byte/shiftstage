import { permanentRedirect } from "next/navigation";
import { resolveMyDancrCity } from "@/src/lib/dancr/markets";
import { homeTvHref } from "@/src/lib/dancr/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    city?: string;
    video?: string;
    venue?: string;
  }>;
};

export default async function MyDancrTvPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const city = resolveMyDancrCity(params.city);
  permanentRedirect(homeTvHref(city, {
    videoId: cleanUuid(params.video),
    venueId: cleanUuid(params.venue),
  }));
}

function cleanUuid(value: string | undefined) {
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
