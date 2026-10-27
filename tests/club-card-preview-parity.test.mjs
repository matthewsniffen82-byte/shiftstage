import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const fittingSource = await readFile(new URL("../public/club-logos.js", import.meta.url), "utf8");
const styles = postcss.parse(await readFile(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8"));
const savedStyles = postcss.parse(await readFile(new URL("../app/dashboard/saved-venue-cards.generated.css", import.meta.url), "utf8"));

function fixture() {
  class Logo {
    complete = true;
    isConnected = true;
    clientWidth = 120;
    clientHeight = 120;
    values = {};
    style = { setProperty: (name, value) => { this.values[name] = value; } };
    constructor(className, source, artwork) {
      this.className = className;
      this.replace(source, artwork);
    }
    replace(source, { width = 240, height = 144, mark = [76, 28, 88, 88] } = {}) {
      this.currentSrc = this.src = source;
      this.naturalWidth = width * 5;
      this.naturalHeight = height * 5;
      this.artwork = { width, height, mark };
      this.pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const inside = x >= mark[0] && x < mark[0] + mark[2] && y >= mark[1] && y < mark[1] + mark[3];
        this.pixels.set(inside ? [210, 147, 43, 255] : [2, 2, 2, 255], (y * width + x) * 4);
      }
    }
  }
  const context = {
    window: {}, HTMLImageElement: Logo,
    document: {
      readyState: "loading", addEventListener() {},
      createElement() {
        let sampled;
        return { getContext: () => ({ drawImage: image => { sampled = image; }, getImageData: () => ({ data: sampled.pixels }) }) };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fittingSource, context);
  return { Logo, fit: context.window.MydancrClubLogos.fit };
}

function visibleArtwork(image) {
  const { width, height, mark } = image.artwork;
  const contain = Math.min(image.clientWidth / width, image.clientHeight / height);
  const scale = Number(image.values["--venue-logo-scale"]);
  return {
    width: mark[2] * contain * scale / image.clientWidth,
    height: mark[3] * contain * scale / image.clientHeight,
    x: .5 + (mark[0] + mark[2] / 2 - width / 2) * contain * scale / image.clientWidth + parseFloat(image.values["--venue-logo-shift-x"]) / 100,
    y: .5 + (mark[1] + mark[3] / 2 - height / 2) * contain * scale / image.clientHeight + parseFloat(image.values["--venue-logo-shift-y"]) / 100,
  };
}

test("club cards and previews show the same large, centered artwork for wide, portrait and off-center uploads", async () => {
  const { Logo, fit } = fixture();
  const uploads = [{}, { width: 144, height: 240, mark: [28, 76, 88, 88] }, { mark: [40, 28, 88, 88] }];
  for (const [index, artwork] of uploads.entries()) {
    let preview;
    for (const [className, size] of [["venue-detail-logo", 112], ["home-venue-discovery-logo", 128], ["venue-card-logo", 140]]) {
      const image = new Logo(className, `/upload-${index}.webp`, artwork);
      image.clientWidth = image.clientHeight = size;
      await fit(image);
      const visible = visibleArtwork(image);
      assert.ok(Math.abs(visible.width - .94) < .001, `${className} fills its artwork slot`);
      assert.ok(Math.abs(visible.height - .94) < .001);
      assert.ok(Math.abs(visible.x - .5) < .001);
      assert.ok(Math.abs(visible.y - .5) < .001);
      if (preview) assert.deepEqual(image.values, preview, "card and preview use identical fitting and clipping");
      else preview = image.values;
    }
  }
});

test("changing the uploaded logo and resizing the card preserve preview parity", async () => {
  const { Logo, fit } = fixture();
  const card = new Logo("home-venue-discovery-logo", "/before.webp");
  await fit(card);
  const previousTransform = card.values.transform;
  const artwork = { mark: [24, 40, 140, 60] };
  card.replace("/after.webp", artwork);
  const preview = new Logo("venue-detail-logo", "/after.webp", artwork);
  await fit(card);
  await fit(preview);
  assert.notEqual(card.values.transform, previousTransform);
  assert.deepEqual(card.values, preview.values);
  for (const size of [88, 140, 200]) {
    card.clientWidth = card.clientHeight = size;
    await fit(card);
    assert.deepEqual(card.values, preview.values);
    assert.ok(Math.abs(visibleArtwork(card).width - .94) < .001);
  }
});

test("the final card and preview CSS share one artwork transform", () => {
  const finalRule = new Map();
  styles.walkRules(rule => {
    for (const name of ["home-venue-discovery-logo", "venue-detail-logo"]) {
      if (rule.selectors.some(selector => selector.endsWith(` .${name}`)) && rule.nodes.some(node => node.prop === "transform")) finalRule.set(name, rule);
    }
  });
  const card = finalRule.get("home-venue-discovery-logo");
  assert.ok(card);
  assert.equal(card, finalRule.get("venue-detail-logo"), "a single rule prevents preview/card styling from diverging");
  const transform = card.nodes.find(node => node.prop === "transform");
  assert.equal(transform.important, true);
  for (const variable of ["--venue-logo-shift-x", "--venue-logo-shift-y", "--venue-logo-scale"]) assert.ok(transform.value.includes(variable));
  let savedTransform;
  savedStyles.walkRules(rule => {
    if (rule.selector.includes("[data-venue-scroll-feed]") && rule.selector.includes(".home-venue-discovery-logo")) {
      const declaration = rule.nodes.find(node => node.prop === "transform");
      if (declaration) savedTransform = declaration;
    }
  });
  assert.ok(savedTransform, "Saved cards include the shared logo transform");
  assert.equal(savedTransform.value, transform.value);
  assert.equal(savedTransform.important, true);
});
