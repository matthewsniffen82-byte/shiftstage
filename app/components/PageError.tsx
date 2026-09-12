"use client";

import styles from "./PageError.module.css";

export function PageError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="page-error-title">
        <p className={styles.brand}>mydancr</p>
        <h1 id="page-error-title">This page couldn&apos;t load</h1>
        <p role="alert">Try loading it again, or return home to continue browsing.</p>
        <button type="button" onClick={reset}>Try again</button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recovery must replace the failed document without relying on the client router. */}
        <a href="/">Return home</a>
      </section>
    </main>
  );
}
