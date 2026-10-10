import type { VipRequest } from "./vip-types";

function calendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n|\r/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function timestamp(value: string) { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
// Fold by UTF-8 octets, without splitting multibyte characters (RFC 5545).
function fold(line: string) {
  let output = "", bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { output += "\r\n "; bytes = 1; }
    output += char; bytes += size;
  }
  return output;
}
export function vipCalendar(request: VipRequest, venueName: string) {
  if (request.status !== "confirmed") return "";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyDancr//VIP Visits//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${calendarText(request.id)}@mydancr`, `DTSTAMP:${timestamp(request.created_at)}`, `DTSTART:${timestamp(request.starts_at)}`,
    `SUMMARY:${calendarText(`VIP visit · ${venueName}`)}`, `LOCATION:${calendarText(venueName)}`,
    `DESCRIPTION:${calendarText(`Confirmed visit at ${venueName}. Venue timezone: ${request.timezone}. Check MyDancr for the latest details.`)}`,
    "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
