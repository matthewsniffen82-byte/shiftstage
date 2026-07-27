import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("empty edit-profile photo buttons carry a distinct unoccupied gallery slot", () => {
  const editorMarkup =
    liveSource.match(/function approvedVisualProfileEditorMarkup\(profile\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const replacementCheck =
    liveSource.match(/function isReplacingApprovedPhotoTarget\(profile, target\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const availableSlots =
    liveSource.match(/function availableApprovedGallerySortOrders\(profile\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";

  assert.match(availableSlots, /editableDancerPhotoRows\(profile\)/);
  assert.match(availableSlots, /\.filter\(\(sortOrder\) => !used\.has\(sortOrder\)\)/);
  assert.match(editorMarkup, /const availableGallerySortOrders = availableApprovedGallerySortOrders\(profile\)/);
  assert.match(editorMarkup, /`gallery-add:\$\{availableGallerySortOrders\[index\]/);
  assert.match(editorMarkup, /data-approved-visual-photo-add="\$\{target\}"/);
  assert.match(editorMarkup, /data-approved-visual-photo-add="gallery-add"/);
  assert.match(replacementCheck, /text === "gallery-add" \|\| text\.startsWith\("gallery-add:"\)\) return false/);
});

test("the edit-profile UI uses the server-confirmed slot after an add upload", () => {
  const uploadHandler =
    liveSource.match(/async function uploadApprovedDancerPhoto\(file, target\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";

  assert.match(uploadHandler, /const requestedAddSortOrder = String\(target \|\| ""\)\.startsWith\("gallery-add:"\)/);
  assert.match(uploadHandler, /nextAvailableApprovedGallerySortOrder\(profile\)/);
  assert.doesNotMatch(uploadHandler, /\(profile\?\.galleryPhotoUrls \|\| \[\]\)\.length \+ 1/);
  assert.match(uploadHandler, /const serverSortOrder = Number\(uploaded\.sortOrder \?\? uploaded\.sort_order\)/);
  assert.match(uploadHandler, /const resolvedSortOrder = Number\.isInteger\(serverSortOrder\)/);
  assert.match(uploadHandler, /=== resolvedSortOrder/);
  assert.match(uploadHandler, /sort_order: resolvedSortOrder/);
  assert.match(uploadHandler, /sortOrder: resolvedSortOrder/);
  assert.match(uploadHandler, /uploadedPhotoTarget = `gallery:\$\{Math\.max\(0, resolvedSortOrder - 1\)\}`/);
  assert.match(uploadHandler, /normalizeLocalDancerPhotos\(profile\)/);
});

test("the general gallery-photo action is also treated as an addition", () => {
  assert.match(
    liveSource,
    /if \(action === "gallery-photo"\) \{\s*pendingApprovedPhotoTarget = "gallery-add"/
  );
});
