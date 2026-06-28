import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "mydancr",
  description: "Choose your city. See who's working now.",
  applicationName: "mydancr",
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
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
