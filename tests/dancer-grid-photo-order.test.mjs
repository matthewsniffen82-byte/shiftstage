import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const state = { publicProfilePhotoUrl: (profile) => profile.photo || "" };
const functions = ["demoDancerGridPriority", "spreadDancerGridPhotos"].map((name) => {
  const source = homeSource.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?(?=\\r?\\n    (?:async )?function )`))?.[0];
  assert.ok(source, `${name} must come from the production renderer`);
  return source;
}).join("\n");
vm.runInNewContext(functions, state);
const mix = (profiles) => Array.from(state.spreadDancerGridPhotos(profiles));
const starId = "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2";
const photoKey = (profile) => profile.photo.split(/[?#]/)[0].split("/").pop();

function assertSpaced(profiles) {
  profiles.forEach((profile, index) => {
    for (let previous = Math.max(0, index - 3); previous < index; previous++) {
      assert.notEqual(photoKey(profile), photoKey(profiles[previous]),
        `photo at ${index} must be separated from ${previous}`);
    }
  });
}

test("separates unranked demo photo copies without giving a fixed profile priority", () => {
  const profiles = Array.from({ length: 14 }, (_, photo) =>
    Array.from({ length: 8 }, (_, copy) => Object.freeze({
      id: `${photo}-${copy}`,
      photo: `https://images.test/user-${photo}-${copy}/mydancr-echo-grid-v1/source-${photo}.webp`,
    }))).flat();
  const star = Object.freeze({ id: starId, photo: "https://images.test/original/source-0.webp" });
  profiles.push(star);
  const input = Object.freeze(profiles);
  const before = [...input];
  const result = mix(input);
  assert.notEqual(result[0], star);
  assertSpaced(result);
  assert.equal(result.length, input.length);
  assert.equal(new Set(result).size, input.length);
  assert.ok(result.every((profile) => input.includes(profile)), "preserve every original profile object");
  assert.deepEqual(input, before, "do not mutate the source roster");
  assert.deepEqual(mix(input), result, "refreshes must preserve the same order");
});

test("recognizes query variants and copies across different demo storage directories", () => {
  const profiles = Array.from({ length: 5 }, (_, photo) => [
    { id: `${photo}-original`, photo: `https://images.test/original/${photo}.webp?width=640` },
    { id: `${photo}-query`, photo: `https://images.test/original/${photo}.webp?width=320` },
    { id: `${photo}-echo`, photo: `https://images.test/copy/mydancr-echo-grid-v1/${photo}.webp` },
    { id: `${photo}-other`, photo: `https://images.test/copy/mydancr-other-grid-v1/${photo}.webp` },
  ]).flat();
  assertSpaced(mix(profiles));
});

test("preserves ordering of unique uploads with generic filenames and does not pin a different Star", () => {
  const profiles = [
    { id: "first", photo: "https://images.test/first/photo.jpg" },
    { id: "second", photo: "https://images.test/second/photo.jpg" },
    { id: "third", photo: "https://images.test/third/portrait.jpg" },
    { id: "another-star", name: "Star", photo: "https://images.test/fourth/photo.jpg" },
  ];
  assert.deepEqual(mix(profiles), profiles);
});

test("small filtered rosters retain everyone even when repeats cannot be avoided", () => {
  assert.deepEqual(mix([]), []);
  const star = { id: starId };
  assert.deepEqual(mix([star]), [star]);
  const profiles = [
    { id: "a", photo: "https://images.test/repeated.jpg" },
    { id: "b", photo: "https://images.test/repeated.jpg" },
    { id: "c", photo: "https://images.test/repeated.jpg" },
    { id: "d", photo: "https://images.test/other.jpg" },
    { id: "missing" },
    star,
  ];
  const result = mix(profiles);
  assert.equal(result.length, profiles.length);
  assert.equal(new Set(result).size, profiles.length);
  assert.ok(result.every((profile) => profiles.includes(profile)));
  assert.notEqual(result[0].photo, result[1].photo, "use another available photo before repeating");
});

test("photo spreading never changes earned discovery positions",()=>{
  const profiles=[{id:'a',photo:'same',discovery:{position:1}},{id:'b',photo:'same',discovery:{position:2}},{id:'c',photo:'other',discovery:{position:3}}];
  assert.deepEqual(mix(profiles),profiles);
});
