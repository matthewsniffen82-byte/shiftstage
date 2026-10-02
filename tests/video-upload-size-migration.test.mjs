import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("25 MB migration preserves existing videos and rejects oversized reservations and updates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema storage;
      create table storage.buckets (id text primary key, file_size_limit bigint, public boolean);
      insert into storage.buckets values ('mydancr-tv-videos',104857600,false),('dancer-photos',10485760,false);
      create table public.mydancr_tv_videos (id int primary key, file_size_bytes bigint not null,
        constraint mydancr_tv_file_size_check check (file_size_bytes between 1 and 104857600));
      insert into public.mydancr_tv_videos values (1,21380470);`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261002020500_video_upload_25mb_limit.sql", import.meta.url), "utf8"));
    assert.equal(Number((await db.query("select file_size_bytes from public.mydancr_tv_videos where id=1")).rows[0].file_size_bytes), 21380470);
    await db.exec("insert into public.mydancr_tv_videos values (2,26214400)");
    for (const size of [0,26214401,104857600]) {
      await assert.rejects(db.exec(`insert into public.mydancr_tv_videos values (3,${size})`), /mydancr_tv_file_size_check/);
    }
    await assert.rejects(db.exec("update public.mydancr_tv_videos set file_size_bytes=26214401 where id=1"), /mydancr_tv_file_size_check/);
    const buckets = (await db.query("select id,file_size_limit,public from storage.buckets order by id")).rows;
    assert.deepEqual(buckets.map(bucket => ({ ...bucket, file_size_limit: Number(bucket.file_size_limit) })), [
      { id: "dancer-photos", file_size_limit: 10485760, public: false },
      { id: "mydancr-tv-videos", file_size_limit: 26214400, public: false },
    ]);
  } finally { await db.close(); }
});
