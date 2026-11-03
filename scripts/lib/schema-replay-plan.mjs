import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { baselineDigest } from './schema-baseline.mjs';

/** Verify immutable replay inputs without credentials or database access. */
export async function schemaReplayPlan(root) {
  const directory = join(root, 'supabase/baselines');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 1);
  assert.match(manifest.baseline, /^\d{14}_application\.sql$/);
  assert.match(manifest.cutoffVersion, /^\d{14}$/);
  assert.ok(manifest.baseline.startsWith(manifest.cutoffVersion + '_'));
  const sql = await readFile(join(directory, manifest.baseline), 'utf8');
  assert.equal(baselineDigest(sql), manifest.baselineSha256, 'Application baseline changed; a new rehearsal is required');
  assert.equal(baselineDigest(await readFile(join(directory, 'catalog.sql'), 'utf8')), manifest.catalogQuerySha256, 'Catalog query changed');
  assert.equal(baselineDigest(await readFile(join(root, 'scripts/lib/schema-baseline.mjs'), 'utf8')), manifest.catalogNormalizerSha256, 'Catalog normalization changed');
  assert.equal(baselineDigest(await readFile(join(root, 'scripts/rehearse-schema-baseline.mjs'), 'utf8')), manifest.rehearsalRunnerSha256, 'Rehearsal runner changed');
  assert.ok(Array.isArray(manifest.coveredMigrations) && manifest.coveredMigrations.length > 0);
  const covered = new Set();
  const migrations = join(root, 'supabase/migrations');
  for (const entry of manifest.coveredMigrations) {
    assert.match(entry.file, /^(?:\d{12}|\d{14})_[a-z0-9_]+\.sql$/);
    assert.ok(!covered.has(entry.file), 'Duplicate covered migration');
    assert.ok(entry.file.split('_')[0] <= manifest.cutoffVersion);
    assert.equal(baselineDigest(await readFile(join(migrations, entry.file), 'utf8')), entry.sha256, 'Covered migration changed: ' + entry.file);
    covered.add(entry.file);
  }
  const history = JSON.parse(await readFile(join(directory, 'forward-history.json'), 'utf8'));
  assert.equal(history.format, 1);
  const excluded = new Set();
  for (const entry of history.excluded) {
    assert.match(entry.file, /^\d{14}_[a-z0-9_]+\.sql$/);
    assert.ok(entry.file.split('_')[0] > manifest.cutoffVersion);
    assert.ok(!covered.has(entry.file));
    assert.equal(baselineDigest(await readFile(join(migrations, entry.file), 'utf8')), entry.sha256, 'Excluded migration changed: ' + entry.file);
    assert.ok(entry.reason);
    excluded.add(entry.file);
  }
  const mapped = new Map();
  for (const entry of history.entries) {
    assert.match(entry.file, /^\d{14}_[a-z0-9_]+\.sql$/);
    assert.ok(!covered.has(entry.file) && !excluded.has(entry.file) && !mapped.has(entry.file));
    assert.match(entry.deployedVersion, /^\d{14}$/);
    assert.ok(entry.deployedVersion > manifest.cutoffVersion);
    assert.equal(baselineDigest(await readFile(join(migrations, entry.file), 'utf8')), entry.sha256, 'Reconciled migration changed: ' + entry.file);
    mapped.set(entry.file, entry.deployedVersion);
  }
  const replayVersion = file => mapped.get(file) || file.split('_')[0];
  const forwardMigrations = (await readdir(migrations)).filter(file => file.endsWith('.sql') && !covered.has(file) && !excluded.has(file))
    .sort((a,b) => replayVersion(a).localeCompare(replayVersion(b)));
  for (const file of forwardMigrations) {
    assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/);
    assert.ok(file.split('_')[0] > manifest.cutoffVersion, 'Uncovered migration precedes the baseline: ' + file);
  }
  assert.equal(new Set(forwardMigrations.map(file => file.split('_')[0])).size, forwardMigrations.length, 'Duplicate forward version');
  assert.equal(new Set(forwardMigrations.map(replayVersion)).size, forwardMigrations.length, 'Duplicate deployed forward version');
  assert.ok(Array.isArray(manifest.rehearsals) && manifest.rehearsals.length >= 2, 'Two successful independent reconstructions required');
  const runs = new Set();
  for (const entry of manifest.rehearsals) {
    assert.match(entry.file, /^rehearsal-[a-z0-9-]+\.json$/);
    const text = await readFile(join(directory, entry.file), 'utf8');
    assert.equal(baselineDigest(text), entry.sha256);
    const receipt = JSON.parse(text);
    assert.equal(receipt.project, 'cwpsrrjhrkedwtyatntv');
    assert.equal(receipt.baselineSha256, manifest.baselineSha256);
    assert.equal(receipt.catalogQuerySha256, manifest.catalogQuerySha256);
    assert.equal(receipt.expectedCatalogSha256, manifest.catalogSha256);
    assert.equal(receipt.actualCatalogSha256, manifest.catalogSha256);
    for (const property of ['rebuilt', 'equivalent', 'rollbackVerified', 'ledgerPreserved']) assert.equal(receipt[property], true, property);
    assert.equal(receipt.transactionCommitted, false);
    assert.equal(receipt.error, null);
    assert.ok(receipt.recreatedRelations > 0);
    assert.ok(!runs.has(receipt.startedAt), 'Repeated receipt is not a second rehearsal');
    runs.add(receipt.startedAt);
  }
  return { baseline: manifest.baseline, cutoffVersion: manifest.cutoffVersion, coveredMigrations: covered.size, forwardMigrations,
    excludedMigrations: history.excluded, reconciledMigrations: mapped.size,
    replayFiles: forwardMigrations.map(file => ({ source: file, target: replayVersion(file) + file.slice(file.indexOf('_')) })),
    baselineReplayReady: true, forwardMigrationsRequireValidation: forwardMigrations.length > 0 };
}
