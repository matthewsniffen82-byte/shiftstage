import type { ReactNode } from "react";

export const metadata = {
  title: "Dancr",
  description: "Verified nightlife schedules.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
