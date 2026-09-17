import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";
import {
  evaluateDancerMediaIdentity,
  parseDancerMediaIdentityAnalysis,
} from "../src/lib/dancr/media-identity-core.ts";

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
  personCountConfidence = 0.99,
  singlePersonOnly = personCount === 1,
  referenceMatch = "match",
  confidence = 0.95,
} = {}) {
  return { personCount, personCountConfidence, singlePersonOnly, referenceMatch, confidence };
}

test("single-person moderation ignores avatar matches and still rejects zero or multiple people", () => {
  assert.deepEqual(
    evaluateDancerMediaIdentity(analysis()).decision,
    "approved",
  );
  assert.deepEqual(
    evaluateDancerMediaIdentity(
      analysis({ personCount: 2, singlePersonOnly: false }),
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
    ).reasonCodes[0],
    "dancer_not_visible",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "mismatch" }),
    ).reasonCodes[0],
    "single_dancer_confirmed",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "uncertain", confidence: 0.7 }),
    ).decision,
    "approved",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "not_provided" }),
    ).reasonCodes[0],
    "single_dancer_confirmed",
  );
  assert.equal(
    evaluateDancerMediaIdentity(
      analysis({ referenceMatch: "not_provided" }),
    ).decision,
    "approved",
  );
});

test("identity response parsing distrusts inconsistent model fields", () => {
  assert.deepEqual(
    parseDancerMediaIdentityAnalysis({
      personCount: 2,
      personCountConfidence: 0.99,
      singlePersonOnly: true,
      referenceMatch: "match",
      confidence: 0.95,
    }),
    {
      personCount: 2,
      personCountConfidence: 0.99,
      singlePersonOnly: false,

    },
  );
  assert.equal(
    parseDancerMediaIdentityAnalysis({
      personCount: 1,
      personCountConfidence: 0.99,
      singlePersonOnly: true,
      referenceMatch: "match",
      confidence: 0.9,
    }).personCount,
    1,
  );
  assert.throws(
    () => parseDancerMediaIdentityAnalysis({ personCount: "many" }, true),
    /invalid person count/,
  );
});

test("person count must be independently certain even when the dancer clearly matches", () => {
  for (const personCountConfidence of [undefined, NaN, Infinity, -1, 0.89, 2]) {
    const value = { ...analysis({ confidence: 1 }), personCountConfidence };
    const result = evaluateDancerMediaIdentity(value);
    assert.equal(result.decision, "review");
    assert.deepEqual(result.reasonCodes, ["person_count_uncertain"]);
  }
  assert.equal(evaluateDancerMediaIdentity(analysis({ personCount: 2, confidence: 0.2 })).decision, "rejected");
  assert.equal(evaluateDancerMediaIdentity(analysis({ singlePersonOnly: false })).decision, "review");
});

test("malformed model counts and confidences cannot become a confident single person", () => {
  for (const invalid of [
    { personCount: true }, { personCount: "1" }, { personCount: null }, { personCount: -1 }, { personCount: 1.5 },
    { singlePersonOnly: "true" }, { personCountConfidence: undefined }, { personCountConfidence: "0.99" },
    { personCountConfidence: NaN }, { personCountConfidence: 4 },
  ]) assert.throws(() => parseDancerMediaIdentityAnalysis({ ...analysis(), ...invalid }, true));
});

test("photo and video moderation count people without an avatar reference", () => {
  assert.match(identitySource, /Count every distinct visibly depicted person/);
  assert.match(identitySource, /Do not compare appearance with an avatar or verify identity/);
  assert.match(identitySource, /store: false/);
  for (const text of [identitySource, imageModeration, videoModeration, tvSource]) {
    assert.doesNotMatch(text, /loadApprovedDancerIdentityReference|referenceImage|referenceRequired|DancerIdentityReferenceRequiredError|must match your approved avatar/);
  }
  assert.match(imageModeration, /combineDancerMediaModeration/);
  assert.match(imageModeration, /multiple_people_detected/);
  assert.match(dashboard, /Use a clear solo face photo of yourself/);
  assert.match(dashboard, /Add at least 1 solo picture of yourself/);
  assert.match(videoModeration, /singlePersonOnly: identityAnalysis.singlePersonOnly/);
  assert.match(videoModeration, /strongestDecision\(\[safetyDecision, identityEvaluation.decision\]\)/);
  assert.match(tvSource, /Only you can appear in a profile video/);
  assert.match(studio, /I am the only person shown, and this video is of me\./);
});
