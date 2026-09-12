"use client";

import { PageError } from "./components/PageError";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Page unavailable · mydancr</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0, background: "#0b0b0f" }}>
        <PageError reset={reset} />
      </body>
    </html>
  );
}
