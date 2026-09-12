"use client";

import { PageError } from "./components/PageError";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError reset={reset} />;
}
