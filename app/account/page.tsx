import { Suspense } from "react";
import AccountClient from "./AccountClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <Suspense>
      <AccountClient />
    </Suspense>
  );
}
