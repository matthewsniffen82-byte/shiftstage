export const MYDANCR_PUBLIC_APP_URL = "https://www.mydancr.com";

type PublicAppEnvironment = Record<string, string | undefined>;

const MYDANCR_HOSTS = new Set(["mydancr.com", "www.mydancr.com"]);
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function publicAppUrl(environment: PublicAppEnvironment = process.env) {
  const configured = (
    environment.NEXT_PUBLIC_SITE_URL
    || environment.DANCR_PUBLIC_URL
    || environment.NEXT_PUBLIC_APP_URL
    || environment.APP_URL
    || ""
  ).trim();

  if (!configured) return MYDANCR_PUBLIC_APP_URL;

  try {
    const url = new URL(configured);
    if (url.username || url.password) return MYDANCR_PUBLIC_APP_URL;
    if (MYDANCR_HOSTS.has(url.hostname.toLowerCase())) return MYDANCR_PUBLIC_APP_URL;
    if (environment.NODE_ENV !== "production" && LOCAL_DEVELOPMENT_HOSTS.has(url.hostname.toLowerCase())) {
      return url.origin;
    }
  } catch {
    return MYDANCR_PUBLIC_APP_URL;
  }

  return MYDANCR_PUBLIC_APP_URL;
}
