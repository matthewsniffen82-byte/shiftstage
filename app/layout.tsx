import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { GlobalMobileBottomNav } from "./components/GlobalMobileBottomNav";
import { versionedStaticAssetUrl } from "../src/lib/dancr/static-asset-cache.mjs";
import { androidDeviceClassScript } from "../src/lib/security/android-device-script.mjs";
import "../public/dancr-brand-tokens.v1.css";
import "../public/dancr-palette.v1.css";
import "../public/dancr-button-system.v1.css";
import "../public/dancr-aesthetic.v1.css";
import "../public/dancr-feedback.v1.css";
import "../public/dancr-status-pages.v1.css";
import "../public/dancr-account-forms.v1.css";
import "../public/dancr-ui-consistency.v1.css";
import "./components/dashboard-menu.css";
import "../public/dancr-auth.v1.css";
import "../public/dancr-checkboxes.v1.css";
import "../public/third-party-social-link-warning.css";
import "../public/mydancr-push-invitations.css";
import "../public/venue-brand-themes.css";
import "../public/club-logos.css";
import "../public/club-brand-cards.css";

export const metadata: Metadata = {
  title: "mydancr",
  description: "Choose your city. See who's working now.",
  applicationName: "mydancr",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: versionedStaticAssetUrl("/mydancr-icon.svg"),
    apple: { url: versionedStaticAssetUrl("/mydancr-icon-180.png"), sizes: "180x180", type: "image/png" },
  },
  metadataBase: new URL("https://www.mydancr.com"),
  openGraph: {
    title: "mydancr",
    description: "Choose your city. See who's working now.",
    siteName: "mydancr",
    url: "https://www.mydancr.com",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "mydancr",
    description: "Choose your city. See who's working now.",
  },
  appleWebApp: {
    title: "mydancr",
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "only dark", backgroundColor: "var(--dancr-color-background, #0b0b0b)", color: "var(--dancr-color-text-primary, #f5f3f7)" }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <Script src={versionedStaticAssetUrl("/mydancr-api-transport.js")} strategy="beforeInteractive" />
      <body className="dancr-button-system" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{ __html: androidDeviceClassScript }}
          id="dancr-android-device-classes"
        />
        {children}
        <GlobalMobileBottomNav />
        <script defer src={versionedStaticAssetUrl("/club-logos.js")} />
        <script defer src={versionedStaticAssetUrl("/dancer-content-visibility.js")} />
        <script defer src={versionedStaticAssetUrl("/mydancr-push-invitations.js")} data-device-module={versionedStaticAssetUrl("/mydancr-push-device.js")} />
        {process.env.NODE_ENV === 'production' && <script defer src={versionedStaticAssetUrl('/mydancr-performance.js')} data-release={process.env.VERCEL_GIT_COMMIT_SHA} />}
        <script defer id="mydancr-third-party-social-link-warning" src={versionedStaticAssetUrl("/third-party-social-link-warning.js")} />
      </body>
    </html>
  );
}
