import InternalTapEntry from "../../InternalTapEntry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Club tap | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const encrypted = typeof query.e === "string" ? query.e : "";
  const mac = typeof query.c === "string" ? query.c : "";
  return <InternalTapEntry key={`${id}:${encrypted}:${mac}`} id={id} encrypted={encrypted} mac={mac} />;
}
