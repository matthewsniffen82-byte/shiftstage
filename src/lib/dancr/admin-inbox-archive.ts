import { PublicApiError } from "../api-error-policy";

export const INBOX_KINDS = ["support", "deal_request", "club_application", "page_change"] as const;
export type InboxKind = typeof INBOX_KINDS[number];
export type InboxArchiveItem = { kind: InboxKind; id: string; version: string };
export const INBOX_LABELS: Record<InboxKind, string> = {
  support: "Support messages", deal_request: "Club deal requests", club_application: "Club applications", page_change: "Club page changes",
};

export function parseInboxArchiveAction(body: Record<string, unknown>) {
  if (body.action !== "archive" && body.action !== "restore") throw new PublicApiError("INVALID_REQUEST", "Choose archive or restore.", 400);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw new PublicApiError("INVALID_REQUEST", "Choose between 1 and 100 items.", 400);
  const seen = new Set<string>();
  const items: InboxArchiveItem[] = body.items.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicApiError("INVALID_REQUEST", "Invalid inbox item.", 400);
    const { kind, id, version } = value;
    if (!INBOX_KINDS.includes(kind) || typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || typeof version !== "string" || !Number.isFinite(Date.parse(version))) {
      throw new PublicApiError("INVALID_REQUEST", "Refresh the inbox before trying again.", 400);
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) throw new PublicApiError("INVALID_REQUEST", "Choose each item only once.", 400);
    seen.add(key);
    return { kind, id, version };
  });
  return { action: body.action, items };
}
