import { InternalRoster } from "../../InternalRoster";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <InternalRoster token={(await params).token} />;
}
