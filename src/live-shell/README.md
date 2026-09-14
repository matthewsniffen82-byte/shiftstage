# Homepage source

Edit the files here and run `npm run generate:live-shell`. Commit the source changes together with the generated `outputs/index.html` and refreshed version files. The build checks that source and output agree; editing the output alone fails the build.

- `shell.html` owns the document and page markup (about 2,000 lines).
- `app/` contains the application script, split at complete statement boundaries. `manifest.json` explicitly preserves initialization order.
- `device-bootstrap.js` runs in its original early position.
- `styles/` holds complete CSS rules in their original cascade order. Base, directory and override styles remain separate groups.

The homepage keeps its existing classic-script scope and HTML event handlers. These files are ordered source fragments, not independent ES modules. The generator checks each assembled JavaScript scope using ESLint's recommended rules, including undefined references, with browser globals. Shared handlers are intentionally exempt from unused-variable checks; empty catches and control-character sanitizers retain their existing behavior. CSS is parsed before generation. Any new source fragment must be added once to the manifest.

Production serves the application script and both large stylesheets as versioned, cacheable assets. Their original execution/cascade positions are preserved. The small directory style and device bootstrap remain inline. Development generates the complete HTML at startup; rerun the generator after editing these sources.

The dashboard is separate React code in `app/dashboard`: the root owns session/data loading, role panels own their workspaces, shared controls have no dependency on role panels, and profile/avatar/photo editors are separate modules. Dancer and venue panels load through dynamic imports. Existing extraction-based tests use a source view assembled from the current modules; `dashboard-module-boundaries.test.mjs` also loads actual imports to check the module graph.
