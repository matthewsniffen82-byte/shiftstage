import { safeLocalReturnPath } from "./safe-return-path.ts";

export type AccountEntryParams = Record<string, string | string[] | undefined>;

export function accountEntryHref(params: AccountEntryParams) {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  // Dressing-room taps use a dedicated sign-in with the venue connection context.
  if (/^[A-Za-z0-9_-]{40,120}$/.test(value("venue_nfc"))) return null;
  const role = value("role") === "venue" ? "venue" : value("role") === "dancer" ? "dancer" : "customer";
  const mode = value("mode") === "signup" ? "signup" : "login";
  const query = new URLSearchParams(role === "venue"
    ? { venueAccess: "1", venueMode: mode }
    : { auth: mode, role });
  const returnTo = safeLocalReturnPath(value("return_to"));
  if (returnTo && !/^\/(?:account|auth)(?:[/?#]|$)/.test(returnTo)) query.set("return_to", returnTo);
  return `/?${query.toString()}`;
}
