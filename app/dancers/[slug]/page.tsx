import { notFound, permanentRedirect } from "next/navigation";
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
  const profile = await getDancerProfile(client, slug);
  if (!profile) notFound();
  const queryParams = await searchParams;
  const requestedReturn = safeLocalReturnPath(queryParams?.return_to);
  const vipReturnHref = requestedReturn.split(/[?#]/)[0] === "/vip" ? requestedReturn : "";
  if (profile.slug !== slug) {
    const query = new URLSearchParams();
    for (const key of ["media", "mediaIndex"]) {
      const value = queryParams?.[key];
      if (typeof value === "string") query.set(key, value);
    }
    if (vipReturnHref) query.set("return_to", vipReturnHref);
    permanentRedirect(`/dancers/${profile.slug}${query.size ? `?${query}` : ""}`);
  }

  const content = await loadPublicDancerContent(client, profile);
  return <PublicDancerProfile profile={profile} {...content} vipReturnHref={vipReturnHref} />;
}
