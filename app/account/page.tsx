import { Suspense } from "react";
import AccountClient from "./AccountClient";
import { redirect } from "next/navigation";
import { accountEntryHref, type AccountEntryParams } from "@/src/lib/dancr/account-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<AccountEntryParams> }) {
  const destination = accountEntryHref(await searchParams);
  if (destination) redirect(destination);
  return (
    <Suspense>
      <AccountClient />
    </Suspense>
  );
}
