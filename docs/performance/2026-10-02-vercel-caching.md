# Vercel CDN caching

The CDN policy is set by the Next.js responses, which take precedence over a
duplicated `Cache-Control` entry in `vercel.json`. No Vercel plan or paid feature
change is needed.

| Response | Browser cache | Vercel CDN cache |
| --- | --- | --- |
| Deployment-only home shell | 30 seconds | 1 hour, then up to 5 minutes stale while revalidating |
| App and TV scripts with the exact production content version | 1 year, immutable | 1 year |
| Unversioned or outdated main-script alias | Revalidate | No shared freshness window |
| Invalid or outdated TV chunk | No-store, 404 | No-store |
| Development script responses | Revalidate | No shared freshness window |
| Versioned public static files and Next.js bundles | Existing immutable policy | Vercel's automatic static-file cache |
| Profiles, Working Now, feeds, account and private media responses | Existing no-store policy | Existing no-store policy |

The large app and TV scripts are function responses, so they explicitly set
`s-maxage` to enable Vercel CDN reuse. Browser `max-age` alone does not configure
that function cache. Only the current production version receives this policy.
The home shell contains deployment files, not user or live roster data. New
deployments invalidate the function CDN cache; its browser lifetime stays short.

The temporary site password gate remains in front of all routes. Its
`CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store` restrictions
retain priority for protected HTML/API responses. These routes deliberately do
not emit competing CDN-specific headers. A locked response is never made public
by this change. Static resource access still passes through the gate.

Validation uses focused route/unit tests and lint, including current/old/missing
script versions, development responses, unchanged script bytes, independent shell
response bodies, static-asset versions, live-data cache policies and site-lock
restrictions. No automated browser journeys are used. Performance gains depend
on traffic and cache hits; no measured latency or cost reduction is claimed.

References:
- [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache)
- [Cache-Control precedence](https://vercel.com/docs/headers/cache-control-headers)
- [Next.js response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
