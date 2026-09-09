import { mkdir, writeFile } from "node:fs/promises";
import { metadataReaderFixture } from "../../tests/helpers/local-video-metadata.mjs";
const output = process.env.PERF_OUTPUT || ".qa/metadata-resources";
const samples = [];
for (const kind of ["legacy", "dashboard"]) {
  const fixture = metadataReaderFixture(kind);
  await fixture.expire();
  samples.push({ kind, scenario: "browser emits neither metadata nor error; all scheduled timeouts expire", ...fixture.state() });
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/results.json`, JSON.stringify(samples, null, 2));
console.log(JSON.stringify(samples));
