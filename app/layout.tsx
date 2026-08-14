import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GlobalMobileBottomNav } from "./components/GlobalMobileBottomNav";
import "../public/dancr-brand-tokens.v1.css";
import "../public/dancr-button-system.v1.css";
import "../public/dancr-aesthetic.v1.css";

const androidDeviceClassScript = `
(() => {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.userAgentData && navigator.userAgentData.platform
    ? navigator.userAgentData.platform
    : "";
  const isAndroid = /Android/i.test(userAgent)
    || /Linux.*Mobile/i.test(userAgent)
    || /Android/i.test(platform);
  const isSamsungBrowser = /SamsungBrowser/i.test(userAgent);

  if (!isAndroid && !isSamsungBrowser) return;

  const applyDeviceClasses = (element) => {
    if (!element) return;
    if (isAndroid) element.classList.add("is-android", "android-rendering");
    if (isSamsungBrowser) element.classList.add("is-samsung-browser", "samsung-rendering");
  };

  applyDeviceClasses(document.documentElement);
  applyDeviceClasses(document.body);
})();
`;

export const metadata: Metadata = {
  title: "mydancr",
  description: "Choose your city. See who's working now.",
  applicationName: "mydancr",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/mydancr-icon.svg",
    apple: "/mydancr-icon.svg",
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
  themeColor: "#050507",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="dancr-button-system" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{ __html: androidDeviceClassScript }}
          id="dancr-android-device-classes"
        />
        {children}
        <GlobalMobileBottomNav />
      </body>
    </html>
  );
}
