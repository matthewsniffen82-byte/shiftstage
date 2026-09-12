export const MYDANCR_PUBLIC_APP_URL = "https://www.mydancr.com";

type PublicAppEnvironment = Record<string, string | undefined>;

const MYDANCR_HOSTS = new Set(["mydancr.com", "www.mydancr.com"]);
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PRODUCTION_SUPABASE_REF = "hfmzwadzabmgxkjzmqun";

export function publicAppUrl(environment: PublicAppEnvironment = process.env) {
  const configured = (
    environment.NEXT_PUBLIC_SITE_URL
    || environment.DANCR_PUBLIC_URL
    || environment.NEXT_PUBLIC_APP_URL
    || environment.APP_URL
    || ""
  ).trim();

  if (environment.DANCR_ISOLATED_SUPABASE_REF !== undefined) {
    return isolatedAppUrl(environment, configured);
  }

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

function isolatedAppUrl(environment: PublicAppEnvironment, configured: string) {
  const ref = environment.DANCR_ISOLATED_SUPABASE_REF || "";
  const projectDomain = environment.VERCEL_PROJECT_PRODUCTION_URL || "";
  const validProjectDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(projectDomain);

  if (
    environment.VERCEL !== "1"
    || !/^[a-z]{20}$/.test(ref)
    || ref === PRODUCTION_SUPABASE_REF
    || environment.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`
    || !validProjectDomain
    || projectDomain === "shiftstage.vercel.app"
    || (configured !== `https://${projectDomain}` && configured !== `https://${projectDomain}/`)
  ) {
    // A broken rehearsal configuration must never send its account links to production.
    throw new Error("Invalid isolated application configuration.");
  }

  return `https://${projectDomain}`;
}
