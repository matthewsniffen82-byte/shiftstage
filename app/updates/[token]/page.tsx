import UpdatePreferences from "./UpdatePreferences";

export const dynamic = "force-dynamic";
export const metadata = { title: "Club update preferences | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UpdatePreferences token={token} />;
}
