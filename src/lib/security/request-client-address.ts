import "server-only";

import { isIP } from "node:net";

/** Vercel supplies these headers; other deployments must overwrite them at ingress. */
export function requestClientAddress(request: Request) {
  for (const header of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const address = request.headers.get(header)?.split(",")[0]?.trim() || "";
    const version = isIP(address);
    if (version === 4) return address;
    if (version === 6 && !address.includes("%")) return new URL(`http://[${address}]/`).hostname.slice(1, -1);
  }
  // An arbitrary Cloudflare header or user agent cannot mint a new rate bucket.
  return "unknown";
}
