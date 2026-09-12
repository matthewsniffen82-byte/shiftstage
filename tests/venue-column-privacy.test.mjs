import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {before,after,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,asAccountLifecycleRole} from './helpers/account-lifecycle-database.mjs';
import {publicVenueColumns,privateVenueColumns} from './helpers/venue-column-privacy-deployment.mjs';
const source=readFileSync(new URL('../supabase/migrations/20260912123000_minimize_public_venue_review_columns.sql',import.meta.url),'utf8');
let db,owner,hidden,customer;
before(async()=>{
  db=await createAccountLifecycleDatabase();owner=await seedAccountLifecycle(db,{n:65000,role:'venue'});hidden=await seedAccountLifecycle(db,{n:66000,role:'venue',venueActive:false});
  customer=await seedAccountLifecycle(db,{n:67000,role:'customer'});
  await db.query("update public.venues set page_review_notes='Synthetic private review',qr_code_label='Synthetic internal label'where id=$1",[owner.venueId]);
  await db.exec(source);
});
after(async()=>db?.close());
const query=(role,sql,user=owner.userId)=>asAccountLifecycleRole(db,role,user,()=>db.query(sql));
for(const role of ['anon','authenticated']) {
  test(`${role} retains all twenty public venue fields and existing row visibility`,async()=>{
    const rows=(await query(role,'select '+publicVenueColumns.join(',')+' from public.venues order by id')).rows;
    assert.deepEqual(rows.map(row=>row.id),[owner.venueId]);assert.equal(Object.keys(rows[0]).length,20);
  });
  for(const field of privateVenueColumns)for(const operation of ['select','filter'])test(`${role} cannot ${operation} private venue ${field}`,async()=>{
    await assert.rejects(query(role,operation==='select'?`select ${field} from public.venues`:`select id from public.venues where ${field} is null`),error=>error.code==='42501');
  });
  for(const sql of ['select * from public.venues','select to_jsonb(v)from public.venues v','select public.has_active_club_deal(v)from public.venues v'])test(`${role} cannot bypass venue column privacy using ${sql}`,async()=>{
    await assert.rejects(query(role,sql),error=>error.code==='42501');
  });
}
test('a venue owner still reads their unpublished public projection but cannot read review metadata directly',async()=>{
  const rows=(await query('authenticated','select id,name from public.venues',hidden.userId)).rows;
  assert.ok(rows.some(row=>row.id===hidden.venueId));
  await assert.rejects(query('authenticated','select page_review_notes from public.venues',hidden.userId),error=>error.code==='42501');
});
test('authorized server callers retain the full venue projection and computed offer flag',async()=>{
  const rows=(await query('service_role','select v.*,public.has_active_club_deal(v)offer from public.venues v')).rows;
  assert.equal(rows.length,2);assert.equal(Object.keys(rows[0]).length,31);assert.equal(typeof rows[0].offer,'boolean');
});
test('venue SELECT restriction preserves the independently protected legacy service UPDATE boundary',async()=>{
  for(const [table,column]of [['venues','is_active'],['app_users','account_state']])assert.equal((await db.query('select has_column_privilege($1,$2,$3,$4)allowed',['service_role','public.'+table,column,'UPDATE'])).rows[0].allowed,false);
});
for(const [role,isOwner]of [['anon',false],['authenticated',false],['authenticated',true]])test(`related deal RLS still works for ${role}, owner=${isOwner}`,async()=>{
  const rows=(await query(role,'select id,venue_id,deal_title from public.club_deals',isOwner?owner.userId:role==='authenticated'?customer.userId:null)).rows;
  assert.equal(rows.length,isOwner?1:0);
  if(isOwner)assert.equal(rows[0].venue_id,owner.venueId);
});
