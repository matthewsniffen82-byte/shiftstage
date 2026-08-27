import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateDancerMediaIdentity,
  parseDancerMediaIdentityAnalysis,
} from "../src/lib/dancr/media-identity.ts";

const [identitySource, imageModeration, videoModeration, tvSource, dashboard, studio] =
  await Promise.all([
    readFile(new URL("../src/lib/dancr/media-identity.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/video-moderation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  ]);

function analysis({
  personCount = 1,
  singlePersonOnly = personCount === 1,
  referenceMatch = "match",
  confidence = 0.95,
} = {}) {
  return { personCount, singlePersonOnly, referenceMatch, confidence };
}

test("single-person identity evaluation fails closed for photos and videos", () => {
  assert.deepEqual(
    evaluateDancerMediaIdentity(analysis(), { referenceRequired: true }).decision,
    "approved",
  );
  assert.deepEqual(
    evaluateDancerMediaIdentity(
      analysis({ personCount: 2, singlePersonOnly: false }),
      { referenceRequired: true },
    ),
    {
      decision: "rejected",
      reasonCodes: ["multiple_people_detected"],
      analysis: analysis({ personCount: 2, singlePersonOnly: false }),
    },
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ personCount: 0, singlePersonOnly: false }),
      { referenceRequired: true },
    ).reasonCodes[0],
    "dancer_not_visible",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "mismatch" }),
      { referenceRequired: true },
    ).reasonCodes[0],
    "dancer_identity_mismatch",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "uncertain", confidence: 0.7 }),
      { referenceRequired: true },
    ).decision,
    "review",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "not_provided" }),
      { referenceRequired: true },
    ).reasonCodes[0],
    "dancer_identity_reference_required",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "not_provided" }),
      { referenceRequired: false },
    ).decision,
    "approved",
  );
});

test("identity response parsing distrusts inconsistent model fields", () => {
  assert.deepEqual(
    parseDancerMediaIdentityAnalysis({
      personCount: 2,
      singlePersonOnly: true,
      referenceMatch: "match",
      confidence: 4,
    }, true),
    {
      personCount: 2,
      singlePersonOnly: false,
      referenceMatch: "match",
      confidence: 1,
    },
  );
  assert.equal(
    parseDancerMediaIdentityAnalysis({
      personCount: 1,
      singlePersonOnly: true,
      referenceMatch: "match",
      confidence: 0.9,
    }, false).referenceMatch,
    "not_provided",
  );
  assert.throws(
    () => parseDancerMediaIdentityAnalysis({ personCount: "many" }, true),
    /invalid person count/,
  );
});

test("photo uploads count people and compare against the approved avatar", () => {
  assert.match(identitySource, /Count every distinct visibly depicted person/);
  assert.match(identitySource, /Do not identify or name anyone/);
  assert.match(identitySource, /store: false/);
  assert.match(identitySource, /DANCER_IDENTITY_REFERENCE_BUCKET = "dancer-photos"/);
  assert.match(imageModeration, /\.select\("id, avatar_storage_path"\)/);
  assert.match(imageModeration, /loadApprovedDancerIdentityReference/);
  assert.match(
    imageModeration,
    /analyzeDancerMediaIdentity\(\{[\s\S]*?targetImages: \[image\.buffer\][\s\S]*?mediaType: "photo"[\s\S]*?referenceImage: identityReference/,
  );
  assert.match(imageModeration, /combineDancerMediaModeration/);
  assert.match(imageModeration, /multiple_people_detected/);
  assert.match(imageModeration, /The person in this photo must match your approved avatar/);
  assert.match(dashboard, /Use a clear solo face photo of yourself/);
  assert.match(dashboard, /AI checks that only you appear/);
  assert.match(dashboard, /Add at least 1 solo picture of yourself/);
});

test("video uploads enforce one matching dancer across distributed frames", () => {
  assert.match(
    videoModeration,
    /loadApprovedDancerIdentityReference\([\s\S]*?input\.dancerAvatarStoragePath/,
  );
  assert.match(
    videoModeration,
    /analyzeDancerMediaIdentity\(\{[\s\S]*?targetImages: frames[\s\S]*?mediaType: "video"[\s\S]*?referenceImage: identityReference/,
  );
  assert.match(videoModeration, /identityDecision: identityEvaluation\.decision/);
  assert.match(videoModeration, /singlePersonOnly: identityAnalysis\.singlePersonOnly/);
  assert.match(videoModeration, /strongestDecision\(\[safetyDecision, identityEvaluation\.decision\]\)/);
  assert.match(
    tvSource,
    /MODERATION_IDENTITY_PROFILE_FIELDS = `\$\{IDENTITY_PROFILE_FIELDS\}, avatar_storage_path`/,
  );
  assert.doesNotMatch(
    tvSource,
    /PUBLIC_TV_SELECT[\s\S]{0,300}avatar_storage_path/,
  );
  assert.match(tvSource, /throw new DancerIdentityReferenceRequiredError\(\)/);
  assert.match(
    tvSource,
    /dancerAvatarStoragePath: String\([\s\S]*?avatar_storage_path/,
  );
  assert.match(tvSource, /Only you can appear in a profile video/);
  assert.match(tvSource, /The person in this video must match your approved avatar/);
  assert.match(studio, /I am the only person shown, and this video is of me\./);
  assert.doesNotMatch(studio, /permission from every identifiable person shown/);
});
