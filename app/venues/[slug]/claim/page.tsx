import { redirect } from "next/navigation";

export default function RetiredVenueClaimPage() {
  redirect("/?venueSignup=1");
}
