import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const id = n => "95000000-0000-4000-8000-" + String(n).padStart(12, "0");
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key);
    create table venue_follows(customer_id uuid references app_users,venue_id uuid references venues,primary key(customer_id,venue_id));
    create table qr_redemptions(id uuid primary key,venue_id uuid,customer_id uuid,status text,expires_at timestamptz);
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,guest_name text,email text,phone text,created_at timestamptz default now());
    grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;
  `);
  await pg.exec(readFileSync(new URL("../supabase/migrations/20261007200000_venue_customer_sharing.sql", import.meta.url), "utf8"));
  await pg.query("insert into venues values($1),($2);", [id(1),id(2)]);
  for (const n of [10,11,12]) {
    await pg.query("insert into app_users values($1,'customer','active')", [id(n)]);
    await pg.query("insert into venue_follows values($1,$2),($1,$3)", [id(n),id(1),id(2)]);
  }
});
after(async () => pg?.close());
async function share(customer=10, venue=1) {
  await pg.query("insert into venue_customer_shares(customer_id,venue_id,name,email,city,consent_version) values($1,$2,'Shared Name','shared@example.test','Las Vegas','venue-customer-sharing-v1')", [id(customer),id(venue)]);
}
async function guest(pass, { venue=1,customer=10,expires="1 hour",status="generated",phone="+17025550100" }={}) {
  await pg.query("insert into qr_redemptions values($1,$2,$3,$4,now()+$5::interval)",[id(pass),id(venue),customer===null?null:id(customer),status,expires]);
  await pg.query("insert into venue_guest_list_entries(pass_id,venue_id,guest_name,email,phone) values($1,$2,'Guest Name','guest@example.test',$3)",[id(pass),id(venue),phone]);
}
async function rows(venue=1, source="all",offset=0) {
  return (await pg.query("select * from get_venue_customers($1,$2,$3)",[id(venue),source,offset])).rows;
}
async function transaction(fn) {
  await pg.exec("begin");
  try { await fn(); } finally { await pg.exec("rollback"); }
}
test("following does not disclose identities; explicit consent is venue-specific", () => transaction(async () => {
  assert.equal((await rows()).length,0);
  await share(10,2); assert.equal((await rows()).length,0);
  await share(); const result=await rows();
  assert.equal(result.length,1); assert.equal(result[0].name,"Shared Name"); assert.equal(result[0].is_follower,true); assert.equal(result[0].is_guest,false);
  assert.equal((await rows(1,"guests")).length,0);
}));
test("active guest visits merge with consenting followers without sharing expired or cancelled contacts", () => transaction(async () => {
  await share(); await guest(100); await guest(101); await guest(102,{customer:11,expires:"-1 hour"}); await guest(103,{customer:12,status:"expired"});
  await guest(104,{venue:2,customer:11}); await guest(105,{customer:null,phone:"+17025550105"});
  const result=await rows(); assert.equal(result.length,2);
  const joined=result.find(r=>r.is_follower); assert.equal(joined.is_guest,true); assert.equal(joined.name,"Shared Name"); assert.equal(joined.phone,"+17025550100");
  assert.equal((await rows(1,"followers")).length,1); assert.equal((await rows(1,"guests")).length,2);
}));
test("revoking consent and unfollowing remove contact access while active guest consent remains visit-scoped", () => transaction(async () => {
  await share(); await pg.query("delete from venue_customer_shares where customer_id=$1",[id(10)]); assert.equal((await rows()).length,0);
  await share(); await pg.query("delete from venue_follows where customer_id=$1 and venue_id=$2",[id(10),id(1)]);
  assert.equal((await rows()).length,0); assert.equal((await pg.query("select * from venue_customer_shares")).rows.length,0);
  await guest(110); assert.equal((await rows())[0].is_guest,true);
  await pg.query("update qr_redemptions set expires_at=now()-interval '1 second' where id=$1",[id(110)]); assert.equal((await rows()).length,0);
}));
test("disabled accounts and non-customers are excluded", () => transaction(async () => {
  await share(); await guest(120);
  await pg.query("update app_users set account_state='disabled' where id=$1",[id(10)]); assert.equal((await rows()).length,0);
  await pg.query("update app_users set account_state='active',role='venue' where id=$1",[id(10)]);
  assert.equal((await rows(1,"followers")).length,0);
}));
test("unconsented, orphaned, and malformed contact writes fail database constraints", async () => {
  for (const change of [
    { field:"venue_id", value:id(90) }, { field:"consent_version",value:"" }, { field:"name",value:"A" }, { field:"email",value:"bad" },
  ]) await transaction(async () => {
    const row={customer_id:id(10),venue_id:id(1),name:"Valid Name",email:"valid@example.test",consent_version:"venue-customer-sharing-v1",...{[change.field]:change.value}};
    await assert.rejects(pg.query("insert into venue_customer_shares(customer_id,venue_id,name,email,consent_version) values($1,$2,$3,$4,$5)",Object.values(row)));
  });
});
test("browser roles cannot read or mutate contacts or execute the server-only directory",async()=>{
  for(const role of ["anon","authenticated"]) {
    for(const sql of ["select * from venue_customer_shares","delete from venue_customer_shares","select * from get_venue_customers(null,'all',0)"]) {
      await transaction(async()=>{await pg.exec("set local role "+role);await assert.rejects(pg.query(sql),e=>e.code==="42501");});
    }
  }
  await transaction(async()=>{await pg.exec("set local role service_role");assert.deepEqual(await rows(),[]);});
});
test("paging is bounded and invalid filters are rejected",async()=>{
  for(const args of [[1,"other",0],[1,"all",-1],[1,null,0]]) await transaction(async()=>assert.rejects(rows(...args),e=>e.code==="22023"));
  await transaction(async()=>{await share();assert.equal((await rows(1,"all",1)).length,0);});
});
