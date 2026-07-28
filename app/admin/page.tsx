import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminPage() {
  redirect("/?dancr_dashboard=admin");
}
