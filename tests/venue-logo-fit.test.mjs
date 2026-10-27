import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/live-shell/app/05-real-dancer-dashboard-metrics.js", import.meta.url), "utf8");
const fitting = source.slice(source.indexOf("    function venueLogoFitTarget"), source.indexOf("    function venueDashboardPreviewTime"));

function fit({ width = 240, height = 144, mark = [76, 28, 88, 88], matte = [62, 14, 116, 116], unreadable = false, profile = true } = {}) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const paint = ([left, top, w, h], color) => {
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) pixels.set(color, (y * width + x) * 4);
  };
  if (matte) paint(matte, [2, 2, 2, 255]);
  paint(mark, [210, 147, 43, 255]);
  class Logo {
    naturalWidth = width * 5;
    naturalHeight = height * 5;
    clientWidth = 120;
    clientHeight = 120;
    classList = { contains: name => name === (profile ? "venue-detail-logo" : "home-venue-discovery-logo"), add() {} };
    values = {};
    style = { setProperty: (key, value) => { this.values[key] = value; } };
  }
  const context = {
    HTMLImageElement: Logo,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() {
      if (unreadable) throw new Error("Canvas pixels unavailable");
      return { data: pixels };
    } }) }) },
  };
  vm.createContext(context);
  vm.runInContext(fitting, context);
  const image = new Logo();
  context.fitVenueLogoImage(image);
  const scale = Number(image.values["--venue-logo-scale"]);
  const offsetX = parseFloat(image.values["--venue-logo-shift-x"]) / 100;
  const offsetY = parseFloat(image.values["--venue-logo-shift-y"]) / 100;
  const containScale = 1 / Math.max(width, height);
  return {
    scale,
    visibleWidth: mark[2] * containScale * scale,
    visibleHeight: mark[3] * containScale * scale,
    centerX: .5 + (mark[0] + mark[2] / 2 - width / 2) * containScale * scale + offsetX,
    centerY: .5 + (mark[1] + mark[3] / 2 - height / 2) * containScale * scale + offsetY,
  };
}

test("wide uploads fill the square profile slot with artwork, not their black matte", () => {
  const result = fit();
  assert.ok(Math.abs(result.visibleWidth - .94) < .001);
  assert.ok(Math.abs(result.visibleHeight - .94) < .001);
  assert.equal(result.centerX, .5);
  assert.equal(result.centerY, .5);
});

test("portrait and off-center artwork stay centered and fully inside the slot", () => {
  for (const options of [
    { width: 144, height: 240, mark: [28, 76, 88, 88], matte: [14, 62, 116, 116] },
    { mark: [52, 28, 88, 88], matte: [38, 14, 116, 116] },
  ]) {
    const result = fit(options);
    assert.ok(Math.abs(result.visibleWidth - .94) < .001);
    assert.ok(Math.abs(result.visibleHeight - .94) < .001);
    assert.ok(Math.abs(result.centerX - .5) < .001);
    assert.ok(Math.abs(result.centerY - .5) < .001);
  }
});

test("full artwork and unreadable images retain a safe contain fit", () => {
  assert.equal(fit({ width: 240, height: 240, mark: [0, 0, 240, 240], matte: null }).scale, 1);
  assert.equal(fit({ unreadable: true }).scale, 1);
});

test("profile sizing does not change the discovery card fitting", () => {
  assert.equal(fit({ profile: false }).scale, 1);
});
