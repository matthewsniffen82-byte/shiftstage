export const ADMIN_DATA_CHANGED = "mydancr:admin-data-changed";
export const ADMIN_INBOX_ARCHIVE_CHANGED = "mydancr:admin-inbox-archive-changed";

export function notifyAdminDataChanged(method = "GET") {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase()) && typeof window !== "undefined") {
    window.dispatchEvent?.(new Event(ADMIN_DATA_CHANGED));
  }
}
