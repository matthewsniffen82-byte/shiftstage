import { notFound, permanentRedirect } from "next/navigation";
import { restrictClubProfile } from "@/src/lib/dancr/club-media-permissions";
import { getDancerProfile } from "@/src/lib/dancr/public";
import { loadPublicDancerContent } from "@/src/lib/dancr/public-dancer-content";
import { safeLocalReturnPath } from "@/src/lib/dancr/safe-return-path";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import PublicDancerProfile from "./PublicDancerProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DancerPublicPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const client = createAdminSupabaseClient();
  const queryParams = await searchParams;
  const venueId = typeof queryParams?.venue === "string" ? queryParams.venue : undefined;
  if (venueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) notFound();
  const personalProfile = await getDancerProfile(client, slug);
  const profile = personalProfile && venueId ? await restrictClubProfile(client, personalProfile, venueId) : personalProfile;
  if (!profile) notFound();
  const requestedReturn = safeLocalReturnPath(queryParams?.return_to);
  const vipReturnHref = requestedReturn.split(/[?#]/)[0] === "/vip" ? requestedReturn : "";
  const venueReturnHref = requestedReturn.split(/[?#]/)[0] === "/dashboard/venue" ? requestedReturn : "";
  if (profile.slug !== slug) {
    const query = new URLSearchParams();
    for (const key of ["media", "mediaIndex", "venue"]) {
      const value = queryParams?.[key];
      if (typeof value === "string") query.set(key, value);
    }
    if (vipReturnHref || venueReturnHref) query.set("return_to", vipReturnHref || venueReturnHref);
    permanentRedirect(`/dancers/${profile.slug}${query.size ? `?${query}` : ""}`);
  }

  const content = await loadPublicDancerContent(client, profile, venueId);
  return <PublicDancerProfile profile={profile} {...content} vipReturnHref={vipReturnHref} venueReturnHref={venueReturnHref} />;
}
