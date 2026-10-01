import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("video edit migration raises storage to 100 MB, keeps 30 seconds, and hides edit receipts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets (id text primary key, file_size_limit bigint);
      insert into storage.buckets values ('mydancr-tv-videos',78643200);
      create table public.mydancr_tv_videos (id int primary key, file_size_bytes bigint not null, duration_seconds numeric not null,
        constraint mydancr_tv_file_size_check check (file_size_bytes between 1 and 78643200),
        constraint mydancr_tv_duration_check check (duration_seconds between 1 and 30));
      grant select(id) on public.mydancr_tv_videos to anon,authenticated;
      grant all on public.mydancr_tv_videos to service_role;`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261001210000_video_upload_crop_and_trim.sql", import.meta.url), "utf8"));
    await db.exec(`insert into public.mydancr_tv_videos values (1,104857600,30,'{"version":1}');`);
    await assert.rejects(db.exec(`insert into public.mydancr_tv_videos values (2,104857601,30,null);`), /mydancr_tv_file_size_check/);
    await assert.rejects(db.exec(`insert into public.mydancr_tv_videos values (3,1000,30.001,null);`), /mydancr_tv_duration_check/);
    const result = await db.query(`select file_size_limit,
      has_column_privilege('anon','public.mydancr_tv_videos','upload_edit','SELECT') as anon,
      has_column_privilege('authenticated','public.mydancr_tv_videos','upload_edit','SELECT') as authenticated,
      has_column_privilege('service_role','public.mydancr_tv_videos','upload_edit','SELECT') as service
      from storage.buckets where id='mydancr-tv-videos'`);
    assert.equal(Number(result.rows[0].file_size_limit), 104857600);
    assert.equal(result.rows[0].anon, false); assert.equal(result.rows[0].authenticated, false); assert.equal(result.rows[0].service, true);
  } finally { await db.close(); }
});
