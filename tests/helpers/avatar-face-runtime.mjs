import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as core from "../../src/lib/dancr/avatar-face-core.ts";
import pico from "../../src/lib/dancr/vendor/pico/pico.mjs";

const require = createRequire(import.meta.url);
function load(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports, Buffer, setTimeout, clearTimeout, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected avatar dependency: ${name}`);
    },
  });
  return exports;
}

export const detector = load("src/lib/dancr/avatar-face-detector.ts", {
  "server-only": {}, sharp,
  "./vendor/pico/pico.mjs": pico,
  "./vendor/pico/facefinder.json": require("../../src/lib/dancr/vendor/pico/facefinder.json"),
});

export function avatarRuntime({ createResponse, locate = detector.locateAvatarFace } = {}) {
  return load("src/lib/dancr/avatar-face.ts", {
    "server-only": {}, crypto: require("node:crypto"), sharp,
    "../openai-client": { createOpenAIClient: async () => ({ responses: { create: createResponse || (async () => ({
      output_text: JSON.stringify({ clearFace: true, fullyVisible: true, selectedCandidate: "start", confidence: 0.98, rejectionReason: "" }),
    })) } }) },
    "../server-env.ts": { getOptionalServerEnv: () => null, getServerEnv: () => "synthetic-key" },
    "./avatar-face-core.ts": core,
    "./avatar-face-detector.ts": { locateAvatarFace: locate },
  }, { process: { env: { OPENAI_API_KEY: "synthetic-key" } } });
}

export async function avatarSample(region = { left: 347, top: 469, width: 223, height: 225 }) {
  const buffer = await sharp(readFileSync(new URL("../../scripts/assets/dancer-profile-sheet-2.jpg", import.meta.url)))
    .extract(region).jpeg().toBuffer();
  return { buffer, width: region.width, height: region.height, storageFileName: "fixture.jpg" };
}
