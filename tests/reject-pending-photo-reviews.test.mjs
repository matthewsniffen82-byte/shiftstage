import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAvatarDatabase, seedAvatarDatabase, avatarSnapshot, avatarUser, avatarTemp } from './helpers/avatar-publication-database.mjs';

const sql = readFileSync(new URL('../scripts/reject-pending-photo-reviews.sql', import.meta.url), 'utf8');

test('completed photo reviews become rejected without changing active checks, decisions or approved media; safe to repeat', async () => {
  const db = await createAvatarDatabase();
  try {
    await seedAvatarDatabase(db);
    const photoId = (await db.query('select id from public.dancer_photos limit 1')).rows[0].id;
    const cases = [
      { name: 'avatar', context: 'profile_avatar', reject: true },
      { name: 'main', context: 'profile_main', reject: true },
      { name: 'gallery', context: 'profile_gallery:2', reject: true },
      { name: 'unslotted', context: 'profile_gallery', reject: true },
      { name: 'legacy-completed', context: 'profile_main:0', status: 'completed', reject: true },
      ...['pending', 'moderating', 'moderation_retry', 'moderation_error', 'error'].map(status => ({ name: status, status })),
      { name: 'approved', decision: 'approved', status: 'approved' },
      { name: 'rejected', decision: 'rejected', status: 'rejected' },
      { name: 'admin-decision', review: 'approved' },
      { name: 'linked-photo', imageId: photoId },
      { name: 'published-path', finalPath: 'approved/photo.webp' },
      { name: 'video', context: 'video' },
      { name: 'unknown-context', context: 'profile_gallery:invalid' },
    ];
    for (const item of cases) {
      await db.query(`insert into public.image_moderation_records
        (user_id, temporary_storage_path, upload_context, provider, provider_model, decision, status,
         idempotency_key, reason_codes, review_decision, image_id, final_storage_path, completed_at)
        values ($1,$2,$3,'openai','synthetic',$4,$5,$6,'["person_count_uncertain"]',$7,$8,$9,'2026-01-01T00:00:00Z')`,
      [avatarUser, avatarTemp(item.name), item.context || 'profile_gallery:3', item.decision || 'review',
        item.status || 'pending_review', item.name, item.review || null, item.imageId || null, item.finalPath || null]);
    }
    const before = await avatarSnapshot(db);
    await db.exec(sql);
    const after = await avatarSnapshot(db);
    for (const row of after.image_moderation_records) {
      const item = cases.find(item => item.name === row.idempotency_key);
      const original = before.image_moderation_records.find(record => record.id === row.id);
      if (!item?.reject) { assert.deepEqual(row, original); continue; }
      assert.equal(row.decision, 'rejected');
      assert.equal(row.status, 'rejected');
      assert.deepEqual(row.reason_codes, ['person_count_uncertain', 'photo_approval_not_confirmed']);
      assert.equal(row.completed_at, original.completed_at);
      assert.equal(row.temporary_storage_path, original.temporary_storage_path);
      assert.equal(row.review_decision, null);
      assert.equal(row.next_attempt_at, null);
      assert.equal(row.locked_at, null);
    }
    for (const table of Object.keys(before).filter(table => table !== 'image_moderation_records')) {
      assert.deepEqual(after[table], before[table], `${table} stays unchanged`);
    }
    await db.exec(sql);
    assert.deepEqual(await avatarSnapshot(db), after);
  } finally {
    await db.close();
  }
});
