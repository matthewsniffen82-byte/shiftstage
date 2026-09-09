import { staticAssetVersions } from "../../generated/static-asset-versions.mjs";

export const IMMUTABLE_STATIC_CACHE = "public, max-age=31536000, immutable";
export const REVALIDATE_STATIC_CACHE = "public, max-age=0, must-revalidate";

export function versionedStaticAssetUrl(reference) {
  const [pathname] = reference.split("?");
  const version = staticAssetVersions[pathname];
  return version ? `${pathname}?v=${version}` : reference;
}

// Run after the application script is externalized. Match HTML attributes only;
// leave inline script/style contents, remote URLs, private data and API URLs alone.
export function versionStaticAssetReferences(html) {
  return html.replace(/(<(?:script|style)\b[^>]*>)[\s\S]*?<\/(?:script|style)\s*>|<[^>]+>/gi, tag => {
    const end = tag.indexOf(">");
    return tag.slice(0, end).replace(/\b(src|href)=(['"])(\/[^'"<>]*)\2/g,
      (attribute, name, quote, reference) => `${name}=${quote}${versionedStaticAssetUrl(reference)}${quote}`) + tag.slice(end);
  });
}

export function staticAssetCacheHeaders() {
  return [
    ...[...Object.keys(staticAssetVersions), "/venue-logos/:path*"].map(source => ({
      source, headers: [{ key: "Cache-Control", value: REVALIDATE_STATIC_CACHE }],
    })),
    ...Object.entries(staticAssetVersions).map(([source, version]) => ({
      source, has: [{ type: "query", key: "v", value: version }],
      headers: [{ key: "Cache-Control", value: IMMUTABLE_STATIC_CACHE }],
    })),
    ...[
      "/outputs/dancr-hero-480-10b0c648e5b6.webp",
      "/outputs/dancr-hero-800-5d40507eaa79.webp",
      "/outputs/dancr-hero-1280-70c171eee35b.webp",
    ].map(source => ({ source, headers: [{ key: "Cache-Control", value: IMMUTABLE_STATIC_CACHE }] })),
  ];
}
