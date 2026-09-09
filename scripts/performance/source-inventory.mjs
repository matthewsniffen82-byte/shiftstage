import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { extractLiveShellAppScript } from "../../src/lib/dancr/live-shell-script.mjs";

const output = process.env.PERF_OUTPUT || ".qa/performance";
const bytes = text => ({ raw: Buffer.byteLength(text), gzip: gzipSync(text).length, brotli: brotliCompressSync(text).length });
const html = (await readFile("outputs/index.html", "utf8")).replace(/\r\n?/g, "\n");
const script = extractLiveShellAppScript(html);
const files = execFileSync("rg", ["--files", "app", "src", "public"], { encoding: "utf8" }).trim().split(/\r?\n/);
const sourceFiles = [];
for (const file of files.filter(file => /\.(tsx?|[mc]?js|css)$/.test(file))) {
  const content = await readFile(file, "utf8");
  sourceFiles.push({ file: file.replaceAll("\\", "/"), ...bytes(content), clientComponent: /^['"]use client['"]/m.test(content) });
}
const routeBundles = {};
try {
  const manifest = JSON.parse(await readFile(".next/app-build-manifest.json", "utf8"));
  for (const [route, files] of Object.entries(manifest.pages)) {
    let raw = 0, gzip = 0;
    for (const file of new Set(files.filter(file => file.endsWith(".js")))) {
      const buffer = await readFile(".next/" + file); raw += buffer.length; gzip += gzipSync(buffer).length;
    }
    routeBundles[route] = { raw, gzip, note: "Route entry plus listed shared chunks; layout entry may load additional chunks." };
  }
} catch (error) { routeBundles.unavailable = error.code || error.message; }
const result = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source: { html: bytes(html), appScript: bytes(script), inlineCss: bytes([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join("\n")) },
  fontStylesheets: [...html.matchAll(/https:\/\/fonts.googleapis.com\/css[^"']+/g)].map(match => match[0]),
  routeCount: files.filter(file => /(?:page\.tsx|route\.ts)$/.test(file)).length,
  clientComponentCount: sourceFiles.filter(file => file.clientComponent).length,
  largestSourceFiles: sourceFiles.sort((a, b) => b.raw - a.raw).slice(0, 25),
  routeBundles,
};
await mkdir(output, { recursive: true });
await writeFile(output + "/source-inventory.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ source: result.source, routeCount: result.routeCount, clientComponentCount: result.clientComponentCount, dashboardBundle: routeBundles["/dashboard/customer/page"] }));
