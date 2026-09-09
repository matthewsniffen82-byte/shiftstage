// Fresh Node processes measure loading the built route only; no handlers or network calls run.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.PERF_OUTPUT || ".qa/server-imports";
const routes = ["api/public/tv", "api/public/discovery", "api/public/dancers/[slug]"];
const samples = [];
for (const route of routes) for (let run = 1; run <= 5; run++) {
  const program = `const fs=require('node:fs'); global.gc(); const before=process.memoryUsage().heapUsed; const start=performance.now(); require(${JSON.stringify(`./.next/server/app/${route}/route.js`)}); const loadMs=performance.now()-start; global.gc(); const heapDelta=process.memoryUsage().heapUsed-before; const chunks=Object.keys(require.cache).filter(p=>p.includes('.next')&&p.endsWith('.js')); console.log(JSON.stringify({loadMs,heapDelta,chunkCount:chunks.length,chunkBytes:chunks.reduce((n,p)=>n+fs.statSync(p).size,0),openAiChunks:chunks.filter(p=>/OpenAIError/.test(fs.readFileSync(p,'utf8'))).length,stripeChunks:chunks.filter(p=>/StripeInvalidRequestError/.test(fs.readFileSync(p,'utf8'))).length}));`;
  const result = JSON.parse(execFileSync(process.execPath, ["--expose-gc", "-e", program], { encoding: "utf8" }));
  samples.push({ route, run, ...result });
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/results.json`, JSON.stringify({ note: "Local built-route import only, not production API latency. SDK markers identify loaded bundle text, not provider calls. Five fresh Node processes per route; no secrets or handlers are invoked.", samples }, null, 2));
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify(routes.map(route => { const rows = samples.filter(row => row.route === route); return { route, loadMs: median(rows.map(row => row.loadMs)), heapDelta: median(rows.map(row => row.heapDelta)), chunkBytes: rows[0].chunkBytes, openAiChunks: rows[0].openAiChunks, stripeChunks: rows[0].stripeChunks }; })));
