import { HELP_ROLE_LABELS, helpSupportRole, type HelpRole } from "../../src/lib/dancr/dashboard-help.ts";

type Identity = { accessToken?: string; account?: { id?: string | null; role?: string } | null } | null;
type SupportOptions = { method: string; expectedRole: "customer" | "dancer" | "venue"; headers: Record<string, string>; body: string; signal: AbortSignal; fallbackMessage: string };
export async function sendHelpMessage(
  input: { role: HelpRole; accountId: string; message: string; requestId: string; signal: AbortSignal },
  dependencies: { readSession: () => Identity; request: (path: string, options: SupportOptions) => Promise<{ thread?: { id?: unknown } }> },
) {
  const role = helpSupportRole(input.role);
  const sameAccount = () => {
    const session = dependencies.readSession();
    return Boolean(role && input.accountId && session?.accessToken && session.account?.id === input.accountId && session.account.role === role);
  };
  if (!sameAccount() || !role) throw new Error("Your sign-in changed. Close help and reopen it from your dashboard before sending.");
  const message = input.message.trim();
  if (!message || message.length > 4000) throw new Error("Enter a message of up to 4,000 characters.");
  if (!input.requestId) throw new Error("Unable to prepare the message. Reopen help and try again.");
  input.signal.throwIfAborted();
  const result = await dependencies.request("/api/support", {
    method: "POST", expectedRole: role, headers: { "content-type": "application/json" }, signal: input.signal,
    body: JSON.stringify({ subject: `${HELP_ROLE_LABELS[input.role]} dashboard help`, message, requestId: input.requestId }),
    fallbackMessage: "Unable to send your message. Your draft is still here; please try again.",
  });
  input.signal.throwIfAborted();
  if (!sameAccount()) throw new Error("Your sign-in changed. Open your original account's support inbox to check whether the message arrived.");
  if (typeof result.thread?.id !== "string" || !result.thread.id) throw new Error("Delivery could not be confirmed. Retry this message or check your support inbox.");
  return result.thread.id;
}
