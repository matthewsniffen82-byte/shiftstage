import { NextRequest, NextResponse } from "next/server";
import {
  safeSiteAccessReturnPath,
  SITE_ACCESS_COOKIE_NAME,
  siteAccessConfiguration,
  siteAccessConfigurationIsValid,
  verifySiteAccessSession,
} from "@/src/lib/dancr/site-access";

const ALWAYS_PUBLIC_PAGE_PREFIXES = ["/auth/callback", "/dmca"];

export async function middleware(request: NextRequest) {
  const configuration = siteAccessConfiguration();
  const pathname = request.nextUrl.pathname;

  if (!configuration.enabled) {
    if (pathname === "/access") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isAlwaysPublicPage(pathname)) return NextResponse.next();

  const sessionIsValid =
    siteAccessConfigurationIsValid(configuration) &&
    (await verifySiteAccessSession(
      request.cookies.get(SITE_ACCESS_COOKIE_NAME)?.value,
      configuration.secret,
    ));

  if (pathname === "/access") {
    if (!sessionIsValid) return noStore(NextResponse.next());
    const returnTo = safeSiteAccessReturnPath(
      request.nextUrl.searchParams.get("return"),
    );
    return noStore(NextResponse.redirect(new URL(returnTo, request.url)));
  }

  if (sessionIsValid) return NextResponse.next();

  const accessUrl = new URL("/access", request.url);
  accessUrl.searchParams.set(
    "return",
    safeSiteAccessReturnPath(`${pathname}${request.nextUrl.search}`),
  );
  return noStore(NextResponse.redirect(accessUrl));
}

function isAlwaysPublicPage(pathname: string) {
  return ALWAYS_PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function noStore<T extends NextResponse>(response: T) {
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|map|woff2?|ttf|otf|mp4|webm)$).*)",
  ],
};
