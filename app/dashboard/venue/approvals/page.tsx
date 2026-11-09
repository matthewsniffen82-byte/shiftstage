import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ClubApprovalsEntry() {
  return redirect("/dashboard/venue#venue-dancer-approvals");
}
