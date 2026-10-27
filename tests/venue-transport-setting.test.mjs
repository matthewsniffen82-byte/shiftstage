import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

test('transport defaults off, is readable publicly and only writable through admin authority', async () => {
  const db = new PGlite();
  try {
    // Mirror the live venue privileges and admin-only write policy.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.venues(id integer primary key, name text, club_pickup_enabled boolean not null default false);
      alter table public.venues enable row level security;
      grant select on public.venues to anon, authenticated, service_role;
      grant update on public.venues to authenticated;
      create policy readable on public.venues for select using (true);
      create policy admin_write on public.venues for update to authenticated
        using (current_setting('test.admin',true) = 'yes') with check (current_setting('test.admin',true) = 'yes');
      insert into venues(id,name) values(1,'Existing club');`);
    await db.exec(readFileSync('supabase/migrations/20261027023808_venue_transport_setting.sql','utf8'));
    await db.exec("set role anon");
    assert.equal((await db.query('select transport_enabled from venues')).rows[0].transport_enabled,false);
    await assert.rejects(db.exec('update venues set transport_enabled=true'),e=>e.code==='42501');
    await db.exec("reset role; set role authenticated; set test.admin='no'");
    assert.equal((await db.query('update venues set transport_enabled=true returning id')).rows.length,0);
    await db.exec("set test.admin='yes'");
    assert.equal((await db.query('update venues set transport_enabled=true returning transport_enabled')).rows[0].transport_enabled,true);
    await db.exec('reset role; set role service_role; update venues set transport_enabled=false');
    await assert.rejects(db.exec("update venues set name='Changed'"),e=>e.code==='42501');
    assert.equal((await db.query('select club_pickup_enabled from venues')).rows[0].club_pickup_enabled,false);
  } finally { await db.close(); }
});

test('admin transport input accepts only booleans and preserves an omitted setting', () => {
  const source=readFileSync('src/lib/dancr/admin.ts','utf8');
  const ast=ts.createSourceFile('admin.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='venueInputToRow');
  const exports={};
  vm.runInNewContext(ts.transpileModule(fn.getText(ast)+'\nexport {venueInputToRow};',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,PublicApiError});
  const convert=input=>exports.venueInputToRow(input,false);
  assert.equal('transport_enabled' in convert({}),false);
  for(const value of [true,false]) assert.equal(convert({transportEnabled:value}).transport_enabled,value);
  for(const value of ['true','false',0,1,null,undefined]) assert.throws(()=>convert({transportEnabled:value}),error=>error.status===400);
});
