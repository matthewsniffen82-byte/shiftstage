import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { asIdentity, catalog, createPolicyDatabase, deniedOrEmpty, ids, quote } from "./helpers/rls-database.mjs";

let db;
const ownedPath = `${ids.owner}/fixture.jpg`;
const otherPath = `${ids.other}/fixture.jpg`;
const policies = catalog.policies.filter(p => p.schemaname === "storage");

before(async () => {
  db = await createPolicyDatabase();
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key, public boolean);
    create table storage.objects(id uuid primary key, bucket_id text, name text, owner_id text, metadata jsonb);
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select,insert,update,delete on storage.buckets,storage.objects to anon,authenticated,service_role;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $function$
    declare _parts text[];
    begin select string_to_array(name,'/') into _parts;
    return _parts[1:array_length(_parts,1)-1]; end $function$;`);
  for (const p of policies) {
    await db.exec(`create policy ${quote(p.policyname)} on storage.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(",")} ${p.qual ? `using (${p.qual})` : ""} ${p.with_check ? `with check (${p.with_check})` : ""};`);
  }
  for (const bucket of catalog.buckets) {
    await db.query("insert into storage.buckets values ($1,$2)", [bucket.id, bucket.public]);
    await db.query("insert into storage.objects(id,bucket_id,name,owner_id) values ($1,$2,$3,$4),($5,$2,$6,$7)", [randomUUID(), bucket.id, ownedPath, ids.owner, randomUUID(), otherPath, ids.other]);
  }
  await db.query("update venue_ownership_claims set proof_storage_path=$1 where claimant_user_id=$2", [ownedPath, ids.owner]);
  await db.query("insert into storage.objects(id,bucket_id,name) values ($1,'mydancr-tv-videos',$2)", [randomUUID(), `__originals/${ownedPath}`]);
});
after(async () => { await db?.close(); });

for (const bucket of catalog.buckets) {
  test(`storage: ${bucket.id} rejects direct uploads, overwrites and deletion by ordinary users`, async () => {
    for (const [role, actor] of [["anon", null], ["authenticated", ids.owner], ["authenticated", ids.other]]) {
      const cases = [
        ["insert into storage.objects(id,bucket_id,name,owner_id) values ($1,$2,$3,$4) returning 1", [randomUUID(), bucket.id, `${ids.owner}/new.jpg`, ids.other]],
        ["update storage.objects set metadata='{}' where bucket_id=$1 and name=$2 returning 1", [bucket.id, ownedPath]],
        ["update storage.objects set name=$3 where bucket_id=$1 and name=$2 returning 1", [bucket.id, ownedPath, otherPath]],
        ["delete from storage.objects where bucket_id=$1 and name=$2 returning 1", [bucket.id, ownedPath]],
      ];
      for (const [sql, args] of cases) assert.equal(await asIdentity(db, role, actor, () => deniedOrEmpty(() => db.query(sql, args))), true, `${role}: ${sql.split(" ")[0]}`);
    }
  });
  if (!bucket.public) {
    test(`storage: ${bucket.id} denies private metadata reads by anonymous and unrelated users`, async () => {
      for (const [role, actor] of [["anon", null], ["authenticated", ids.other]]) {
        assert.equal((await asIdentity(db, role, actor, () => db.query("select 1 from storage.objects where bucket_id=$1 and name=$2", [bucket.id, ownedPath]))).rows.length, 0);
      }
    });
  }
}

test("storage: intended owner reads, public venue artwork and active-admin access remain available", async () => {
  for (const bucket of ["dancer-photos", "verification-documents", "mydancr-tv-videos", "venue-ownership-proofs"]) {
    assert.equal((await asIdentity(db, "authenticated", ids.owner, () => db.query("select 1 from storage.objects where bucket_id=$1 and name=$2", [bucket, ownedPath]))).rows.length, 1);
  }
  for (const bucket of ["venue-logo-images", "venue-cover-images", "venue-qr-codes"]) {
    assert.equal((await asIdentity(db, "anon", null, () => db.query("select 1 from storage.objects where bucket_id=$1", [bucket]))).rows.length, 2);
  }
  assert.equal((await asIdentity(db, "authenticated", ids.admin, () => db.query("select 1 from storage.objects where bucket_id='dancr-image-moderation-review'"))).rows.length, 2);
});

test("storage: private originals and moderation uploads do not gain an owner-prefix bypass", async () => {
  for (const bucket of ["dancr-media-originals", "dancr-image-moderation-review", "dancr-image-moderation-temp"]) {
    assert.equal((await asIdentity(db, "authenticated", ids.owner, () => db.query("select 1 from storage.objects where bucket_id=$1", [bucket]))).rows.length, 0);
  }
  assert.equal((await asIdentity(db, "authenticated", ids.owner, () => db.query("select 1 from storage.objects where name=$1", [`__originals/${ownedPath}`]))).rows.length, 0);
});

test("storage: users cannot make buckets public or inherit inactive-admin permissions", async () => {
  for (const [role, actor] of [["anon", null], ["authenticated", ids.owner], ["authenticated", ids.admin]]) {
    assert.equal(await asIdentity(db, role, actor, () => deniedOrEmpty(() => db.query("update storage.buckets set public=true returning 1"))), true);
  }
  await db.query("update app_users set account_state='disabled' where id=$1", [ids.admin]);
  assert.equal((await asIdentity(db, "authenticated", ids.admin, () => db.query("select 1 from storage.objects where bucket_id='dancr-image-moderation-review'"))).rows.length, 0);
});
