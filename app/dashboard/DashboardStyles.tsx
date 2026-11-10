import { versionedStaticAssetUrl } from "@/src/lib/dancr/static-asset-cache.mjs";

export function DashboardStyles() {
  return <link rel="stylesheet" href={versionedStaticAssetUrl("/dashboard-base.css")} />;
}
