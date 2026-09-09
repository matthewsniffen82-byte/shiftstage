import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../src/lib/dancr/video-upload-policy.ts";

const require = createRequire(import.meta.url);
export function videoDecoderFixture(file, { extra = "", output = "", spawnImpl, realFiles = false } = {}) {
  const calls = [], files = [], cache = new Map();
  function load(path, appended = "") {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8") + appended, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, Buffer, Blob, URL, Error, setTimeout, clearTimeout, process: { env: {} }, console: { info() {}, warn() {}, error() {} }, require(name) {
      if (name === "server-only") return {};
      if (name === "./video-upload-policy" || name === "./video-upload-policy.ts") return policy;
      if (name === "./local-video-input.ts") return load(resolve(dirname(path), name));
      if (name === "./video-frame-sampling") return load(resolve(dirname(path), name + ".ts"));
      if (name === "ffmpeg-static") return require(name);
      if (["node:child_process", "child_process"].includes(name)) return { spawn(executable, args, options) {
        calls.push({ executable, args, options });
        if (spawnImpl) return spawnImpl(executable, args, options);
        const child = new EventEmitter();
        child.stderr = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {};
        queueMicrotask(() => { child.stderr.emit("data", Buffer.from(output)); child.emit("close", 0); });
        return child;
      } };
      if (["node:fs/promises", "fs/promises"].includes(name)) {
        if (realFiles) return require(name);
        return { async mkdtemp(prefix) { files.push("directory"); return prefix + "synthetic"; }, async writeFile() { files.push("write"); }, async rm() { files.push("cleanup"); } };
      }
      if (name.startsWith("node:") || ["path", "os"].includes(name)) return require(name);
      return {};
    } });
    return exports;
  }
  return { exports: load(file, extra), calls, files };
}

export function storedVideoFixture(buffer, mimeType = "video/mp4", overrides = {}) {
  return {
    admin: { storage: { from: () => ({ download: async () => ({ data: new Blob([buffer]), error: null }) }) } },
    input: { bucket: "synthetic", storagePath: "owner/video.mp4", expectedBytes: buffer.length, maxBytes: 75 * 1024 * 1024, maxDurationSeconds: 30, mimeType, ...overrides },
  };
}
