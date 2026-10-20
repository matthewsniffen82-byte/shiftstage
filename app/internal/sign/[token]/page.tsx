import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Page() {
  // A guest table token grants roster access, never QR generation or printing.
  // Admin printing now obtains each sign through the authenticated Admin API.
  redirect("/admin");
}
