import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";

const nativeRequire = createRequire(import.meta.url);
const { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader } = nativeRequire("@zxing/library");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { exports, Buffer, Request, URL, process: { env: {} },
    require: name => name in dependencies ? dependencies[name] : nativeRequire(name),
  });
  return exports;
}
const { createTableQrImage } = load("src/lib/dancr/table-qr-image.tsx");
const url = "https://www.mydancr.com/internal/club/00000000-0000-4000-8000-000000000201";

test("branded table PNGs retain a scannable exact table URL at download and print-pack sizes", async () => {
  for (const label of ["Table 201", "VIP & Patio <201>", "W".repeat(60)]) {
    const image = await createTableQrImage(url, label);
    assert.match(image, /^data:image\/png;base64,/);
    const png = Buffer.from(image.split(",")[1], "base64");
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.width, 720); assert.equal(metadata.height, 720);
    for (const width of [720, 240]) {
      const { data, info } = await sharp(png).resize(width).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
      assert.equal(new QRCodeReader().decode(bitmap).getText(), url);
    }
    // Text remains separate from the QR's intact four-module quiet zone.
    const raw = await sharp(png).removeAlpha().greyscale().raw().toBuffer();
    const inkInRows = (start, end) => raw.subarray(start * 720, end * 720).some(value => value < 100);
    assert.equal(inkInRows(8, 80), true, "The table label is rendered above the QR");
    assert.equal(inkInRows(610, 660), true, "The attribution is rendered below the QR");
    assert.equal(inkInRows(660, 710), true, "The website is rendered on its own line");
  }
});

test("image artwork includes the saved table label and exact requested attribution", async () => {
  let markup;
  const renderer = load("src/lib/dancr/table-qr-image.tsx", {
    "next/og": { ImageResponse: class {
      constructor(element) { markup = renderToStaticMarkup(element); }
      async arrayBuffer() { return new ArrayBuffer(0); }
    } },
    qrcode: { toDataURL: async () => "data:image/png;base64,cXI=" },
  });
  await renderer.createTableQrImage(url, "Table 211");
  assert.match(markup, />Table 211</);
  assert.match(markup, />Powered by Mydancr</);
  assert.match(markup, />www\.mydancr\.com</);
});

test("print signs show the current table number, attribution and website, with escaped club text", async () => {
  const Page = load("app/internal/sign/[token]/page.tsx", {
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/internal-roster": { internalScope: async () => ({ venueName: '<Club & lounge>', link: { label: "Table 211" } }) },
    "./PrintSign": { PrintSign: () => null },
    qrcode: { toDataURL: async () => "data:image/png;base64,cXI=" },
  }).default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ token: "synthetic" }) }));
  assert.match(html, /<h2>Table 211<\/h2>/);
  assert.match(html, /Powered by Mydancr/);
  assert.match(html, /href="https:\/\/www\.mydancr\.com">www\.mydancr\.com<\/a>/);
  assert.match(html, /&lt;Club &amp; lounge&gt;/);
  const css = read("app/internal/internal.css");
  assert.match(css, /body:has\(\.ir-sign\)>:not\(\.ir-sign\):not\(:has\(\.ir-sign\)\)/, "Print CSS must keep the layout wrapper containing the sign");
  assert.match(css, /\.ir-sign button,\.ir-sign-screen-only\{display:none\}/);
});
