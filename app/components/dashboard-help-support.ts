import { HELP_ROLE_LABELS, helpSupportRole, type HelpRole } from "../../src/lib/dancr/dashboard-help.ts";

type Identity = { accessToken?: string; account?: { id?: string | null; role?: string } | null } | null;
type SupportOptions = { method: string; expectedRole: "customer" | "dancer" | "venue"; headers?: Record<string, string>; body?: string; signal: AbortSignal; cache?: "no-store"; fallbackMessage: string };
type Dependencies = { readSession: () => Identity; request: (path: string, options: SupportOptions) => Promise<{ thread?: unknown; threads?: unknown }> };
type AccountInput = { role: HelpRole; accountId: string; signal: AbortSignal };
export type HelpMessage = { id: string; body: string; senderRole: string; createdAt: string };
export type HelpThread = { id: string; subject: string; status: string; lastMessageAt: string; messages: HelpMessage[] };

function assertAccount(input: AccountInput, dependencies: Dependencies) {
  input.signal.throwIfAborted();
  const role = helpSupportRole(input.role);
  const session = dependencies.readSession();
  if (!role || !input.accountId || !session?.accessToken || session.account?.id !== input.accountId || session.account.role !== role) {
    throw new Error("Your sign-in changed. Close help and reopen it from your dashboard before continuing.");
  }
  return role;
}
function readThread(value: unknown): HelpThread {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !value.id) throw new Error("The conversation could not be confirmed. Refresh messages or retry your draft.");
  const row = value as Record<string, unknown>;
  return {
    id: value.id, subject: String(row.subject || "Message to the team"), status: String(row.status || "open"), lastMessageAt: String(row.lastMessageAt || ""),
    messages: Array.isArray(row.messages) ? row.messages.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof item.body === "string")).map((item, index) => ({
      id: String(item.id || index), body: String(item.body), senderRole: String(item.senderRole || ""), createdAt: String(item.createdAt || ""),
    })) : [],
  };
}
export async function loadHelpThreads(input: AccountInput, dependencies: Dependencies) {
  const role = assertAccount(input, dependencies);
  const result = await dependencies.request("/api/support", { method: "GET", expectedRole: role, signal: input.signal, cache: "no-store", fallbackMessage: "Unable to load conversations. Please refresh messages." });
  assertAccount(input, dependencies);
  if (!Array.isArray(result.threads)) throw new Error("Conversations could not be loaded. Please refresh messages.");
  return result.threads.map(readThread);
}
export async function sendHelpMessage(
  input: AccountInput & { message: string; requestId: string; subject?: string; threadId?: string },
  dependencies: Dependencies,
) {
  const role = assertAccount(input, dependencies);
  const message = input.message.trim();
  if (!message || message.length > 4000) throw new Error("Enter a message of up to 4,000 characters.");
  const subject = input.subject?.trim() || `${HELP_ROLE_LABELS[input.role]} dashboard help`;
  if (subject.length > 160) throw new Error("Keep the subject to 160 characters or fewer.");
  if (!input.requestId) throw new Error("Unable to prepare the message. Reopen help and try again.");
  input.signal.throwIfAborted();
  const result = await dependencies.request("/api/support", {
    method: "POST", expectedRole: role, headers: { "content-type": "application/json" }, signal: input.signal,
    body: JSON.stringify({ ...(input.threadId ? { threadId: input.threadId } : { subject }), message, requestId: input.requestId }),
    fallbackMessage: "Unable to send your message. Your draft is still here; please try again.",
  });
  assertAccount(input, dependencies);
  const thread = readThread(result.thread);
  if (input.threadId && thread.id !== input.threadId) throw new Error("The reply could not be confirmed. Refresh the conversation before retrying.");
  return thread;
}
