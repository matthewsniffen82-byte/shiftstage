import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const sql = readFileSync(new URL("../supabase/migrations/20260909120820_remove_stale_self_service_permissions.sql",import.meta.url),"utf8");
test("stale account-permission cleanup preserves roles, current pauses and unrelated metadata",async()=>{
  const db=new PGlite();
  try {
    await db.exec("create schema auth; create table public.app_users(id uuid primary key, account_state text, role text); create table auth.users(id uuid primary key, raw_app_meta_data jsonb);");
    const cases=[
      {state:"active",marker:"2026-09-08T12:00:00.000Z",clear:true},
      {state:"disabled",marker:"2026-09-08T12:00:00.000Z"},
      {state:"deleted",marker:"2026-09-08T12:00:00.000Z"},
      {state:"active",marker:"2026-09-09T12:03:00.000Z"},
      {state:"active",marker:"2026-09-09T12:00:00.000Z"},
      {state:"active",marker:"not-a-timestamp"},
      {state:"active",marker:null},
    ];
    for(const [index,c] of cases.entries()){
      c.id="00000000-0000-4000-8000-"+String(index+1).padStart(12,"0");
      c.metadata={mydancr_provisioned_role:"venue",trusted_extra:"retain",mydancr_self_disabled_at:c.marker,mydancr_venue_was_active:true};
      await db.query("insert into public.app_users values($1,$2,'venue')",[c.id,c.state]);
      await db.query("insert into auth.users values($1,$2)",[c.id,JSON.stringify(c.metadata)]);
    }
    for(let run=0;run<2;run++){
      await db.exec(sql);
      const result=await db.query("select a.id,a.role,a.account_state,u.raw_app_meta_data from public.app_users a join auth.users u using(id) order by a.id");
      for(const [index,row] of result.rows.entries()){
        const c=cases[index],expected={...c.metadata};
        if(c.clear){delete expected.mydancr_self_disabled_at;delete expected.mydancr_venue_was_active;}
        assert.deepEqual(row.raw_app_meta_data,expected);
        assert.equal(row.account_state,c.state);
        assert.equal(row.role,"venue");
      }
    }
  } finally { await db.close(); }
});
