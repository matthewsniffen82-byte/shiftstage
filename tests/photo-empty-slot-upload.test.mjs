import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("deleted live photo slots are persisted before a replacement upload", () => {
  const persistHelper =
    liveSource.match(/async function persistQueuedApprovedPhotoDeletionsBeforeUpload\(profile\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const uploadHandler =
    liveSource.match(/async function uploadApprovedDancerPhoto\(file, target\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";

  assert.match(persistHelper, /photoDeletedPayloadFromProfile\(profile\)/);
  assert.match(persistHelper, /patchAuthenticatedJson\("\/api\/dancer\/profile", deletedPayload\)/);
  assert.match(persistHelper, /deletedPhotosStillInServerProfile\(data\.profile, deletedPayload\)/);
  assert.match(persistHelper, /unconfirmedPhotoIds\.length/);
  assert.match(persistHelper, /applyDancerVerificationProfile\(data\.profile\)/);
  assert.match(persistHelper, /clearDeletedDancerPhotos\(refreshedProfile\)/);
  assert.match(uploadHandler, /profile = await persistQueuedApprovedPhotoDeletionsBeforeUpload\(profile\)/);
  assert.ok(
    uploadHandler.indexOf("persistQueuedApprovedPhotoDeletionsBeforeUpload") < uploadHandler.indexOf("assertDancerProfilePhotoLimit"),
    "server-side deletions must release slots before the upload limit check",
  );
});

test("the general gallery-photo action is also treated as an addition", () => {
  assert.match(
    liveSource,
    /if \(action === "gallery-photo"\) \{\s*pendingApprovedPhotoTarget = "gallery-add"/
  );
});

test("public discovery refresh preserves the authenticated dancer photo state and object identity", () => {
  const mergeHelper =
    liveSource.match(/function mergeAuthenticatedDancerIntoDiscovery\(city, liveDancers\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const marketRefresh =
    liveSource.match(/function applyLiveMarket\(city, dancers, tonightDancers, venues\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";

  assert.match(mergeHelper, /if \(!isDancerSession\(\) \|\| city !== activeDancerCity\(\)\) return liveDancers/);
  assert.match(mergeHelper, /const ownProfile = activeDancerProfile\(city\)/);
  assert.match(mergeHelper, /dancer_photos: Array\.isArray\(ownProfile\.dancer_photos\)/);
  assert.match(mergeHelper, /submittedPhotos: Array\.isArray\(ownProfile\.submittedPhotos\)/);
  assert.match(mergeHelper, /Object\.assign\(ownProfile, liveDancers\[ownIndex\], privatePhotoState\)/);
  assert.match(mergeHelper, /liveDancers\[ownIndex\] = ownProfile/);
  assert.match(marketRefresh, /mergeAuthenticatedDancerIntoDiscovery\(/);
});

test("a discovery response cannot erase newly uploaded photos before the next editor render", () => {
  const helperStart = liveSource.indexOf("    function mergeAuthenticatedDancerIntoDiscovery");
  const helperEnd = liveSource.indexOf("    function applyLiveMarket", helperStart);
  const helperSource = liveSource.slice(helperStart, helperEnd);
  const savedRows = [{
    id: "saved-photo",
    storage_path: "user/profile/saved.jpg",
    review_status: "approved",
    is_primary: true,
    sort_order: 0
  }];
  const ownProfile = {
    id: "profile-1",
    name: "Test1Live",
    city: "Las Vegas",
    dancer_photos: savedRows,
    submittedPhotos: [],
    mainPhotoUrl: "https://cdn.example/saved.jpg",
    galleryPhotoUrls: []
  };
  const discoveryProfile = {
    id: "profile-1",
    name: "Test1Live",
    city: "Las Vegas",
    mainPhotoUrl: "",
    galleryPhotoUrls: [],
    followerCount: 4
  };
  const context = {
    activeDancerCity: () => "Las Vegas",
    activeDancerProfile: () => ownProfile,
    discoveryProfile,
    isDancerSession: () => true,
    result: null
  };

  vm.runInNewContext(
    `${helperSource}\nresult = mergeAuthenticatedDancerIntoDiscovery("Las Vegas", [discoveryProfile]);`,
    context
  );

  assert.equal(context.result[0], ownProfile);
  assert.equal(context.result[0].dancer_photos, savedRows);
  assert.equal(context.result[0].mainPhotoUrl, "https://cdn.example/saved.jpg");
  assert.equal(context.result[0].followerCount, 4);
});

test("approved uploads reload the authoritative profile before reporting success", () => {
  const uploadFunction =
    liveSource.match(/async function uploadApprovedDancerPhoto\(file, target\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const confirmationFunction =
    liveSource.match(/async function hydrateConfirmedApprovedDancerPhoto\(uploadResult\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const changeHandler =
    liveSource.match(/dancerDashboard\.addEventListener\("change", async \(event\) => \{[\s\S]*?\r?\n    \}\);/)?.[0] || "";

  assert.match(uploadFunction, /const uploadDecision = normalizedReviewStatus\(data\?\.decision\)/);
  assert.match(uploadFunction, /could not confirm the photo upload status/);
  assert.match(confirmationFunction, /getAuthenticatedJson\("\/api\/dancer\/profile"\)/);
  assert.match(confirmationFunction, /applyDancerVerificationProfile\(data\.profile\)/);
  assert.match(confirmationFunction, /confirmedApprovedDancerPhoto\(localProfile, uploadResult\)/);
  assert.match(changeHandler, /uploadResult = await hydrateConfirmedApprovedDancerPhoto\(uploadResult\)/);
  assert.doesNotMatch(changeHandler, /renderAdminDashboard\(\)/);
  assert.match(changeHandler, /else if \(decision === "rejected"\)/);
});

test("the browser photo source check runs only after deletion state is initialized", () => {
  const deletionQueueIndex = liveSource.indexOf("const queuedDancerPhotoDeletions = new Map()");
  const deletionMatcherIndex = liveSource.indexOf("function photoMatchesDeletedDancerPhoto");
  const sourceCheckIndex = liveSource.indexOf('if (new URLSearchParams(window.location.search).get("photo-source-test") === "1")');

  assert.ok(deletionQueueIndex >= 0);
  assert.ok(deletionMatcherIndex > deletionQueueIndex);
  assert.ok(sourceCheckIndex > deletionMatcherIndex);
});
