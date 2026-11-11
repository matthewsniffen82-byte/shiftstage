import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createClubDepartureDatabase } from "./helpers/club-departure-database.mjs";
import { asAccountLifecycleRole, seedAccountLifecycle } from "./helpers/account-lifecycle-database.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);
function migration(suffix) {
  const filename = readdirSync(migrations).find(name => name.endsWith(`_${suffix}.sql`));
  return readFileSync(new URL(filename, migrations), "utf8");
}

test("only a site owner can permanently delete the named club, close its workspace and retain its history", async () => {
  const db = await createClubDepartureDatabase();
  try {
    for (const [source, table] of [
      ["initial_schema", "admin_actions"], ["venue_team_operations", "venue_team_invitations"],
      ["venue_claim_codes", "venue_claim_codes"], ["mydancr_internal_roster", "internal_roster_links"],
    ]) {
      const ddl = migration(source).match(new RegExp(`create table (?:if not exists )?public\\.${table} \\([\\s\\S]*?\\n\\);`))[0];
      await db.exec(ddl);
      await db.exec(`grant all on public.${table} to service_role`);
    }
    await db.exec("alter table public.app_users add column admin_workspace_role text");
    await db.exec(migration("admin_delete_club"));
    const actor = await seedAccountLifecycle(db, { n: 100, role: "admin" });
    const target = await seedAccountLifecycle(db, { n: 1000, role: "venue" });
    const other = await seedAccountLifecycle(db, { n: 2000, role: "venue" });
    const staff = await seedAccountLifecycle(db, { n: 3000, role: "venue" });
    const dancer = await seedAccountLifecycle(db, { n: 4000, role: "dancer" });
    const read = async (sql, args = [target.venueId]) => (await db.query(sql, args)).rows[0];
    const remove = (name = "Synthetic Venue", role = "service_role") => asAccountLifecycleRole(db, role, actor.userId, () =>
      read("select public.admin_delete_club($1,$2,$3) as receipt", [actor.userId, target.venueId, name]));
    for (const id of [target.venueId, other.venueId]) {
      await db.query("insert into public.internal_roster_links(venue_id,kind,label) values($1,'table','Table 1')", [id]);
      await db.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,approved_by_user_id) values($1,$2,$3)", [id, dancer.dancerId, actor.userId]);
    }
    await db.query("insert into public.venue_team_members(venue_id,user_id,role) values ($1,$2,'staff')", [target.venueId, staff.userId]);
    await db.query("insert into public.venue_claim_codes(venue_id,code_digest,created_by,expires_at) values ($1,repeat('a',64),$2,now()+interval '1 day')", [target.venueId, actor.userId]);
    await db.query("insert into public.venue_team_invitations(venue_id,email,role,token_digest,invited_by_user_id,expires_at) values ($1,'invited@example.invalid','staff',repeat('b',64),$2,now()+interval '1 day')", [target.venueId, target.userId]);

    await db.query("update public.app_users set admin_workspace_role='support' where id=$1", [actor.userId]);
    await assert.rejects(remove(), error => error.code === "42501");
    await db.query("update public.app_users set admin_workspace_role='owner' where id=$1", [actor.userId]);
    await assert.rejects(remove("Wrong club"), error => error.code === "22023");
    for (const role of ["anon", "authenticated"]) await assert.rejects(remove("Synthetic Venue", role), error => error.code === "42501");
    assert.deepEqual(await read("select is_active,admin_deleted_at from public.venues where id=$1"), { is_active: true, admin_deleted_at: null });

    const result = await remove();
    assert.equal(result.receipt.venueId, target.venueId);
    assert.ok(Number.isFinite(Date.parse(result.receipt.deletedAt)));
    assert.deepEqual(await remove(), result);
    assert.deepEqual(await read("select is_active,owner_user_id from public.venues where id=$1 and admin_deleted_at is not null"), { is_active: false, owner_user_id: null });
    assert.equal((await read("select status from public.venue_team_members where venue_id=$1")).status, "removed");
    assert.equal((await read("select active from public.internal_roster_links where venue_id=$1")).active, false);
    assert.ok((await read("select revoked_at from public.venue_claim_codes where venue_id=$1")).revoked_at);
    assert.ok((await read("select revoked_at from public.venue_team_invitations where venue_id=$1")).revoked_at);
    assert.equal((await read("select count(*)::int n from public.admin_actions where target_id=$1 and action='delete_club'")).n, 1);
    assert.equal((await read("select status from public.venue_dancer_affiliations where venue_id=$1")).status, "revoked");
    assert.equal((await read("select status from public.venue_dancer_affiliations where venue_id=$1", [other.venueId])).status, "active");
    assert.equal((await read("select active from public.internal_roster_links where venue_id=$1", [other.venueId])).active, true);
    assert.equal((await read("select status from public.dancer_profiles where id=$1", [dancer.dancerId])).status, "approved");
    await assert.rejects(db.query("update public.venues set owner_user_id=$2 where id=$1", [target.venueId, target.userId]), error => error.code === "23514");
  } finally { await db.close(); }
});
