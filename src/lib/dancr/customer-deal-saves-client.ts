import {
  persistRefreshedBrowserAuthSession,
  readBrowserAuthSession,
} from "./browser-session";
import type { DealSourceType } from "./types";

export function hasSignedInCustomerDealAccount() {
  const session = readBrowserAuthSession();
  return Boolean(session?.accessToken && session.account?.role === "customer");
}

export async function loadCustomerDealSavedState(dealId: string, signal?: AbortSignal) {
  if (!hasSignedInCustomerDealAccount()) return null;
  const data = await requestCustomerDealSaveJson(
    `/api/customer/deal-saves?dealId=${encodeURIComponent(dealId)}`,
    { cache: "no-store", signal },
  );
  return data.persisted !== false && data.saved === true;
}

export async function setCustomerDealSavedInAccount(input: {
  dealId: string;
  saved: boolean;
  sourceType: DealSourceType;
  dancerId?: string | null;
}) {
  if (!hasSignedInCustomerDealAccount()) return null;
  const data = await requestCustomerDealSaveJson("/api/customer/deal-saves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.persisted !== false;
}

async function requestCustomerDealSaveJson(path: string, options: RequestInit) {
  const session = readBrowserAuthSession();
  if (!session?.accessToken || session.account?.role !== "customer") {
    throw new Error("Sign in with a guest account to save this Club Deal.");
  }

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.headers || {}),
      authorization: `Bearer ${session.accessToken}`,
      ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Unable to update this saved Club Deal.");
  }
  if (data.session) persistRefreshedBrowserAuthSession(data.session);
  return data;
}
