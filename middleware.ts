import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringRequestSession, SESSION_RESPONSE_HEADERS } from "./src/lib/supabase/session-transport";
import { resolveApiError } from "./src/lib/api-error-policy";

export async function middleware(request: NextRequest) {
  // Public cacheable routes never receive credential response headers.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/public/") && path !== "/api/public/media-likes") return NextResponse.next();
  if (!request.headers.has("authorization")) return NextResponse.next();
  try {
    const session = await refreshExpiringRequestSession(request);
    const headers = new Headers(request.headers);
    if (session) {
      headers.set("authorization", `Bearer ${session.accessToken}`);
      headers.set("x-dancr-refresh-token", session.refreshToken);
    }
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("vercel-cdn-cache-control", "no-store");
    if (session) {
      response.headers.set(SESSION_RESPONSE_HEADERS.access, session.accessToken);
      response.headers.set(SESSION_RESPONSE_HEADERS.refresh, session.refreshToken);
      response.headers.set(SESSION_RESPONSE_HEADERS.expires, String(session.expiresAt));
    }
    return response;
  } catch (error) {
    const resolved = resolveApiError(error, "We couldn't verify your session. Please try again.", 503);
    return NextResponse.json(resolved.body, { status: resolved.status, headers: { "cache-control": "private, no-store" } });
  }
}

export const config = { matcher: "/api/:path*" };
