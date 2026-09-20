import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as version from "../../src/lib/dancr/dancer-agreement-version.ts";

const require = createRequire(import.meta.url);

export function loadAgreementComponent(file, globals = {}, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../../app/components/${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (name in dependencies) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime" || name === "react-dom") return require(name);
    if (name === "next/link") return { default: props => React.createElement("a", props) };
    if (name === "@/src/lib/dancr/dancer-agreement-version") return version;
    if (name === "./LegalDocument" || name === "../components/LegalDocument") return loadAgreementComponent("LegalDocument.tsx");
    if (name === "@/src/content/legal/dancer-agreement.json") return { default: require("../../src/content/legal/dancer-agreement.json") };
    if (name.endsWith(".css")) return {};
    throw new Error(name);
  } });
  return exports;
}
