import CustomerEmailPreferenceLink from "./CustomerEmailPreferenceLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preferences | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerEmailPreferenceLink token={token} />;
}
