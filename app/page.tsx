export default function HomePage() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          fetch("https://raw.githubusercontent.com/matthewsniffen82-byte/shiftstage/main/outputs/index.html", { cache: "no-store" })
            .then((response) => response.text())
            .then((html) => {
              const withBase = html.replace("<head>", '<head><base href="/outputs/">');
              document.open();
              document.write(withBase);
              document.close();
            })
            .catch(() => {
              document.body.innerHTML = '<a href="https://github.com/matthewsniffen82-byte/shiftstage/blob/main/outputs/index.html">Open Dancr source</a>';
            });
        `,
      }}
    />
  );
}
