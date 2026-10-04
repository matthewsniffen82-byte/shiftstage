import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import { importMediaModule } from './helpers/server-media-module.mjs';

const { responsivePublicImage } = await importMediaModule('responsive-image.ts');
const shell = readFileSync("outputs/index.html", "utf8");
const client = { storage: { from: () => ({ getPublicUrl: (path, options) => {
  if (options) assert.equal(options.transform.resize, "contain", "preserve the full photo aspect ratio");
  return { data: { publicUrl: `https://images.example/${path}${options ? `?width=${options.transform.width}&quality=${options.transform.quality}` : ""}` } };
} }) } };

test("tiny avatar candidates preserve full-size fallbacks and the existing watermarked source", () => {
  const path = "owner/photo.r320-480-640.m1200x1800.f35x40.jpg";
  const image = responsivePublicImage(client, "photos", path);
  assert.match(image.imageSrcSet, /\.w320\.webp\?width=96&quality=80 96w/);
  assert.match(image.imageSrcSet, /\.w320\.webp\?width=160&quality=80 160w/);
  assert.equal(image.imageUrl, `https://images.example/${path}.w480.webp`);
  assert.equal(image.masterImageUrl, `https://images.example/${path}`);
  assert.equal(image.imageFocalX, 35);
  assert.equal(image.imageFocalY, 40);
  for (const width of [80, 120, 240]) {
    const small = responsivePublicImage(client, "photos", `owner/small.r0.m${width}x300.jpg`);
    const widths = [...small.imageSrcSet.matchAll(/ (\d+)w/g)].map(match => Number(match[1]));
    assert.ok(widths.every(candidate => candidate <= width), "delivery must not upscale");
    assert.equal(small.imageUrl, small.masterImageUrl, "small original stays the fallback");
  }
});

test("thumbnail candidates do not downgrade CSS portraits or native fallback images", () => {
  const context = vm.createContext({ safeCssUrl: value => value, safeExternalHref: value => value, escapeOptionValue: value => value });
  for (const name of ["responsiveCssImageSet", "nativeResponsivePhotoAttrs"]) {
    const source = shell.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
    assert.ok(source);
    vm.runInContext(source, context);
  }
  const original = "https://images.example/320 320w, https://images.example/480 480w, https://images.example/640 640w";
  const added = "https://images.example/96 96w, https://images.example/160 160w, " + original;
  const previous = context.responsiveCssImageSet(original);
  const current = context.responsiveCssImageSet(added);
  for (const candidate of previous.slice(10, -1).split(", ")) assert.ok(current.includes(candidate));
  assert.match(context.nativeResponsivePhotoAttrs("https://images.example/master", added), /^src="https:\/\/images.example\/320"/);
  assert.match(context.nativeResponsivePhotoAttrs("https://images.example/master", "https://images.example/96 96w, https://images.example/240 240w"), /^src="https:\/\/images.example\/240"/);
  assert.match(context.nativeResponsivePhotoAttrs("https://images.example/master", added, 96), /^src="https:\/\/images.example\/96"/, "lineup fallback stays thumbnail-sized when srcset is unavailable");
});

test("phone grid sources use small photos without changing the full image source", () => {
  const context = vm.createContext({ URL });
  for (const name of ["escapeHtml", "escapeOptionValue", "safeExternalHref", "mobileThumbnailSource"]) {
    vm.runInContext(shell.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))[0], context);
  }
  const source = context.mobileThumbnailSource("https://images.example/160 160w, https://images.example/320 320w, https://images.example/480 480w, https://images.example/full 1600w");
  assert.match(source, /media="\(max-width: 520px\)"/);
  assert.match(source, /\/320 320w/);
  assert.doesNotMatch(source, /\/480|\/full/);
  assert.equal(context.mobileThumbnailSource(""), "", "legacy photos retain the normal img fallback");
  assert.equal(context.mobileThumbnailSource("javascript:alert(1) 320w, https://images.example/large 1280w"), "");
  assert.doesNotMatch(context.mobileThumbnailSource('https://images.example/"onload="evil 320w'), /"onload="/);
  const gallery = shell.match(/function profilePhotoThumbMarkup\([^]*?(?=\n    function galleryMarkup)/)[0];
  assert.match(gallery, /mobileThumbnailSource\(item.photoSrcSet\)/);
  assert.match(gallery, /data-photo-url="\$\{displayText\(item.photoUrl\)\}"/, "opening a photo retains its larger URL");
  assert.match(shell, /mobileThumbnailSource\(photoSrcSet\)/, "the external directory uses the same mobile source");
});

test("profile avatars choose pixel density from their display width", () => {
  const context = vm.createContext({ safeCssUrl: value => value });
  vm.runInContext(shell.match(/    function responsiveCssImageSet\([^]*?\n    \}/)[0], context);
  const image = context.responsiveCssImageSet("https://images.example/96 96w, https://images.example/320 320w, https://images.example/480 480w", 96);
  assert.match(image, /\/96'\) 1x/);
  assert.match(image, /\/320'\) 3\.3333333333333335x/);
  assert.match(image, /\/480'\) 5x/);
  assert.match(shell, /responsiveCssImageSet\(publicAvatarPhotoSrcSet\(profile\), 96\)/);
});

test("an avatar without smaller variants keeps its own photo", () => {
  const context = vm.createContext({ publicAvatarPhotoUrl: profile => profile.avatar || profile.main, publicProfilePhotoUrl: profile => profile.main, publicProfilePhotoSrcSet: () => 'https://images.example/main 320w' });
  vm.runInContext(shell.match(/    function publicAvatarPhotoSrcSet\([^]*?\n    \}/)[0], context);
  assert.equal(context.publicAvatarPhotoSrcSet({avatar:'legacy-avatar',main:'main'}), '');
  assert.equal(context.publicAvatarPhotoSrcSet({main:'main'}), 'https://images.example/main 320w');
  assert.equal(context.publicAvatarPhotoSrcSet({avatar:'avatar',main:'main',avatarPhotoSrcSet:'https://images.example/avatar 320w'}), 'https://images.example/avatar 320w');
});

test("club lineup requests stay thumbnail-sized and bounded even with fifty working dancers", () => {
  const source = shell.match(/function venueLineupMarkup\([^]*?(?=\n    function venueCardQrMarkup)/)?.[0];
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const context = vm.createContext({
    isWorkingTonight: () => true, shiftStartMinutes: () => 0,
    publicAvatarPhotoUrl: profile => profile.photo,
    publicAvatarPhotoSrcSet: () => "",
    nativeResponsivePhotoAttrs: (url, srcSet, width) => {
      assert.equal(width, 96);
      return url ? `src="${url}"` : "";
    },
    escapeHtml: escape, escapeOptionValue: escape,
    avatarPhotoPosition: () => "50% 50%", profileReferenceValue: profile => profile.id,
  });
  vm.runInContext(source, context);
  const profiles = Array.from({ length: 50 }, (_, index) => ({ id: String(index), name: index ? `Dancer ${index}` : "<Dancer", photo: "https://images.example/avatar" }));
  const firstCard = context.venueLineupMarkup({}, "Las Vegas", { profiles, mobile: true, eager: true });
  assert.equal((firstCard.match(/<img /g) || []).length, 5);
  assert.equal((firstCard.match(/loading="eager" fetchpriority="high"/g) || []).length, 5);
  assert.match(firstCard, /aria-label="45 more dancers working now">\+45<\/span>/);
  assert.match(firstCard, /<strong>50<\/strong><span>NOW<\/span>/);
  assert.match(firstCard, /aria-label="50 dancers working now"/);
  assert.match(firstCard, /venue-lineup-avatar-initial">&lt;<\/span>/);
  assert.match(firstCard, /data-venue-dancer-profile/);
  const laterCard = context.venueLineupMarkup({}, "Las Vegas", { profiles });
  assert.equal((laterCard.match(/loading="lazy" fetchpriority="auto"/g) || []).length, 4);
  assert.match(laterCard, />\+46<\/span>/);
  const withoutPhoto = context.venueLineupMarkup({}, "Las Vegas", { profiles: [{ id: "1", name: " Star ", photo: "" }] });
  assert.doesNotMatch(withoutPhoto, /<img /);
  assert.match(withoutPhoto, /venue-lineup-avatar-initial">S<\/span>/);
  for (const count of [0, 1, 4, 5, 6]) {
    const markup = context.venueLineupMarkup({}, "Las Vegas", { profiles: profiles.slice(0, count), mobile: true });
    assert.equal((markup.match(/data-venue-dancer-profile/g) || []).length, Math.min(count, 5));
    if (count > 5) assert.match(markup, /aria-label="1 more dancers working now">\+1<\/span>/);
    else assert.doesNotMatch(markup, /home-venue-discovery-lineup-count/);
    if (count) assert.match(markup, new RegExp(`<strong>${count}</strong><span>NOW</span>`));
    else assert.match(markup, /No dancers listed now/);
  }
});

test("small profile galleries load together while large galleries prioritize their first two rows", () => {
  const source = shell.match(/function profilePhotoThumbMarkup\([^]*?(?=\n    function galleryMarkup)/)?.[0];
  const render = new Function('nativeResponsivePhotoAttrs', 'mobileThumbnailSource', 'escapeHtml', 'displayText', 'escapeOptionValue', 'PROFILE_MEDIA_PAGE_SIZE', `${source}; return profilePhotoThumbMarkup;`)(
    () => 'src="https://images.example/photo"', () => '', value => String(value), value => String(value), value => String(value), 12,
  );
  for (const [total, index, loading, priority] of [
    [1, 0, 'eager', 'high'],
    [12, 2, 'eager', 'high'],
    [12, 6, 'eager', 'auto'],
    [12, 11, 'eager', 'auto'],
    [13, 0, 'eager', 'high'],
    [13, 5, 'eager', 'auto'],
    [13, 6, 'lazy', 'auto'],
    [50, 20, 'lazy', 'auto'],
  ]) {
    const markup = render({ index, photoClass: 'photo', photoUrl: 'https://images.example/photo' }, total);
    assert.match(markup, new RegExp(`loading="${loading}"`));
    assert.match(markup, new RegExp(`fetchpriority="${priority}"`));
  }
});

test("a large dancer directory prioritizes all opening rows without eagerly requesting every photo", () => {
  const context = vm.createContext({
    ALL_CITIES: "All cities", profileDiscoveryCity: (_, city) => city,
    escapeHtml: String, escapeOptionValue: String, slugify: String,
    profileReferenceValue: profile => profile.id,
    publicProfilePhotoUrl: () => "https://images.example/photo",
    publicProfilePhotoSrcSet: () => "https://images.example/photo-small 320w",
    customPhotoAttrs: () => ({ className: "", style: "" }),
    nativeResponsivePhotoAttrs: () => 'src="https://images.example/photo-small"',
    mobileThumbnailSource: () => '<source media="(max-width: 520px)" srcset="https://images.example/photo-small 320w">', isWorkingTonight: () => false,
    profileCardDistanceLabel: () => "", homeDiscoveryFeedStatus: () => ({className: "is-open"}),
    homeDancerGridScheduleLabel: () => "Not working now",
  });
  vm.runInContext(shell.match(/function homeDancerGridCard\([^]*?(?=\n    function spreadDancerGridPhotos)/)[0], context);
  const cards = Array.from({length: 500}, (_, index) => context.homeDancerGridCard({id: String(index), name: `Dancer ${index}`}, "Las Vegas", true, index));
  assert.equal(cards.filter(markup => markup.includes('loading="eager" fetchpriority="high"')).length, 12);
  assert.equal(cards.filter(markup => markup.includes('loading="lazy" fetchpriority="auto"')).length, 488);
  assert.ok(cards.slice(0, 12).every(markup => markup.includes(' src="https://images.example/photo-small"')));
  assert.ok(cards.slice(12).every(markup => markup.includes(' data-grid-src="https://images.example/photo-small"') && markup.includes('data-grid-srcset="https://images.example/photo-small 320w"')));
  assert.ok(cards.slice(12).every(markup => !/\s(?:src|srcset)=/.test(markup)), "distant cards must not start native image requests");
});

test("responsive hero assets retain geometry and use content-addressed, smaller WebP files", async () => {
  const original = readFileSync("public/outputs/dancr-hero.webp");
  const hero = shell.match(/<img[^>]*class="hero-art"[^>]*>/)?.[0];
  assert.ok(hero);
  assert.match(hero, /width="1590"\s+height="889"/);
  const candidates = [...hero.matchAll(/\/outputs\/(dancr-hero-(\d+)-([a-f0-9]+)\.webp) (\d+)w/g)];
  assert.equal(candidates.length, 3);
  for (const [, name, width, hash, descriptor] of candidates) {
    const data = readFileSync(`public/outputs/${name}`);
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, Number(width));
    assert.equal(width, descriptor);
    assert.ok(Math.abs(metadata.height / metadata.width - 889 / 1590) < .002);
    assert.equal(createHash("sha256").update(data).digest("hex").slice(0, 12), hash);
    assert.ok(data.length < original.length);
  }
});
