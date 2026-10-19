export const ADMIN_DATA_CHANGED = "mydancr:admin-data-changed";

export function notifyAdminDataChanged(method = "GET") {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase()) && typeof window !== "undefined") {
    window.dispatchEvent?.(new Event(ADMIN_DATA_CHANGED));
  }
}
