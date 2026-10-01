import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { AsyncLocalStorage } from "node:async_hooks";

// Execute the real deadline scope against a deterministic clock. No network or
// production credentials are involved, and concurrent waves advance together.
export function virtualServerJob() {
  let now = 0, nextId = 0;
  const scheduled = new Map();
  const setTimer = (callback, delay = 0) => {
    const id = ++nextId; scheduled.set(id, { at: now + delay, callback }); return id;
  };
  const api = {};
  const code = ts.transpileModule(readFileSync(new URL("../../src/lib/server-job.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports: api, AbortController, AbortSignal, Request,
    performance: { now: () => now }, setTimeout: setTimer, clearTimeout: id => scheduled.delete(id),
    require: () => ({ AsyncLocalStorage }),
  });
  return {
    api, performance: { now: () => now },
    delay: ms => new Promise(resolve => setTimer(resolve, ms)),
    async run(operation) {
      let done = false, value, failure;
      Promise.resolve().then(operation).then(result => { value = result; done = true; }, error => { failure = error; done = true; });
      for (let turns = 0; !done && turns < 10000; turns++) {
        await new Promise(setImmediate);
        if (done) break;
        if (!scheduled.size) throw Error("Unscheduled virtual operation");
        now = Math.min(...[...scheduled.values()].map(item => item.at));
        for (const [id, item] of [...scheduled]) if (item.at === now) { scheduled.delete(id); item.callback(); }
      }
      if (!done) throw Error("Virtual worker did not finish");
      if (failure) throw failure;
      return value;
    },
  };
}
