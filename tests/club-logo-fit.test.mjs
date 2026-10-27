import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const source = await readFile(new URL("../public/club-logos.js", import.meta.url), "utf8");

function fixture({ width = 240, height = 144, mark = [76, 28, 88, 88], matte = [62, 14, 116, 116], unreadable = false } = {}) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const paint = ([left, top, w, h], color) => {
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) pixels.set(color, (y * width + x) * 4);
  };
  if (matte) paint(matte, [2, 2, 2, 255]);
  paint(mark, [210, 147, 43, 255]);
  class Logo {
    naturalWidth = width * 5; naturalHeight = height * 5;
    clientWidth = 80; clientHeight = 80;
    isConnected = true; complete = true; src = "https://images.test/logo.webp";
    values = {}; style = { setProperty: (key, value) => { this.values[key] = value; } };
    matches() { return true; }
  }
  const samples = [], observed = new Set(), listeners = {};
  let mutation, resized, reads = 0;
  const image = new Logo();
  const context = { HTMLImageElement: Logo,
    Image: class extends Logo { constructor() { super(); samples.push(this); } },
    ResizeObserver: class { constructor(callback) { resized = callback; } observe(item) { observed.add(item); } unobserve(item) { observed.delete(item); } },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    window: { addEventListener() {} },
    document: { readyState: "complete", documentElement: {}, querySelectorAll: () => [image],
      addEventListener: (event, callback) => { listeners[event] = callback; },
      createElement: () => { let drawn; return { getContext: () => ({ drawImage(item) { drawn = item; }, getImageData() {
        reads++;
        if (unreadable && !drawn.crossOrigin) throw new Error("Tainted canvas");
        return { data: pixels };
      } }) }; }
    },
  };
  vm.runInNewContext(source, context);
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const result = (target = image) => {
    const scale = Number(target.values["--venue-logo-scale"]);
    const ratio = width / height, boxRatio = target.clientWidth / target.clientHeight;
    const pw = Math.min(1, ratio / boxRatio), ph = Math.min(1, boxRatio / ratio);
    return { scale, w: mark[2] / width * pw * scale, h: mark[3] / height * ph * scale,
      x: .5 + ((mark[0] + mark[2] / 2) / width - .5) * pw * scale + parseFloat(target.values["--venue-logo-shift-x"]) / 100,
      y: .5 + ((mark[1] + mark[3] / 2) / height - .5) * ph * scale + parseFloat(target.values["--venue-logo-shift-y"]) / 100 };
  };
  return { image, samples, observed, listeners, Logo, flush, result, fit: context.window.MydancrClubLogos.fit,
    resize: () => resized([{ target: image }]), mutate: records => mutation(records), reads: () => reads };
}

test("padded wide, portrait and off-center artwork fills its slot without cropping", async () => {
  for (const options of [undefined,
    { width: 144, height: 240, mark: [28, 76, 88, 88], matte: [14, 62, 116, 116] },
    { mark: [52, 28, 88, 88], matte: [38, 14, 116, 116] },
  ]) {
    const f = fixture(options); await f.flush();
    const result = f.result();
    assert.ok(Math.abs(result.w - .94) < .001);
    assert.ok(Math.abs(result.h - .94) < .001);
    assert.ok(Math.abs(result.x - .5) < .001);
    assert.ok(Math.abs(result.y - .5) < .001);
    assert.match(f.image.values["clip-path"], /^inset\(/);
  }
});

test("wide wordmarks stay fully visible in a square and a wide slot", async () => {
  const f = fixture({ mark: [20, 50, 200, 44], matte: null });
  await f.flush();
  assert.ok(f.result().w <= .941); assert.ok(f.result().h < .94);
  f.image.clientWidth = 240; f.image.clientHeight = 104;
  f.resize(); await f.flush();
  assert.ok(f.result().w <= .941); assert.ok(f.result().h <= .941);
  assert.equal(f.reads(), 1, "resize reuses the source's measured bounds");
});

test("full-frame and CORS-denied logos keep safe contain sizing and their original URL", async () => {
  const full = fixture({ width: 240, height: 240, mark: [0, 0, 240, 240], matte: null });
  await full.flush(); assert.equal(full.result().scale, 1);
  const blocked = fixture({ unreadable: true });
  assert.equal(blocked.samples[0].crossOrigin, "anonymous");
  blocked.samples[0].onerror(); await blocked.flush();
  assert.equal(blocked.result().scale, 1);
  assert.equal(blocked.image.src, "https://images.test/logo.webp");
  assert.equal(blocked.image.crossOrigin, undefined);
});

test("cross-origin sampling enlarges logos and ignores stale responses after replacement", async () => {
  const fitted = fixture({ unreadable: true });
  fitted.samples[0].onload(); await fitted.flush();
  assert.ok(Math.abs(fitted.result().w - .94) < .001);
  const stale = fixture({ unreadable: true });
  stale.image.src = "https://images.test/replacement.webp";
  stale.samples[0].onload(); await stale.flush();
  assert.equal(stale.image.values.transform, undefined);
});

test("cached, lazy and inserted logos are fitted; removed nodes are released", async () => {
  const f = fixture(); await f.flush();
  assert.ok(f.observed.has(f.image));
  const added = new f.Logo();
  f.mutate([{ type: "childList", addedNodes: [added] }]); await f.flush();
  assert.ok(f.observed.has(added)); assert.equal(f.result(added).scale, f.result().scale);
  assert.equal(f.reads(), 1, "same source is only sampled once");
  added.values = {}; f.listeners.load({ target: added }); await f.flush();
  assert.ok(added.values.transform);
  added.isConnected = false; f.mutate([{ type: "childList", addedNodes: [] }]);
  assert.equal(f.observed.has(added), false);
});

test("all app documents load the shared fitter and larger dashboard logo slots", async () => {
  for (const path of ["app/layout.tsx", "src/live-shell/shell.html", "app/embed/venues/[slug]/route.ts"]) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(text, /club-logos\.js/); assert.match(text, /club-logos\.css/);
  }
  const css = await readFile(new URL("../public/club-logos.css", import.meta.url), "utf8");
  postcss.parse(css);
  assert.match(css, /venue-review-logo \{ width: 80px; height: 80px; padding: 0;/);
  for (const name of ["venue-review-logo", "venue-dashboard-logo", "home-venue-discovery-logo", "venue-card-logo", "venue-detail-logo", "ir-venue-logo", "club-entry-brand", "venue-embed-logo", "data-club-logo"]) assert.ok(source.includes(name), name);
});
