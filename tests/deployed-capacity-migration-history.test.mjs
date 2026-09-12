import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';import{dirname,join,resolve}from'node:path';import test from'node:test';
const root=new URL('../',import.meta.url);
const{verifyMigrationHistory}=await import(new URL('scripts/check-supabase-migrations.mjs',root));
const expected=[
 {file:'20260912052200_enforce_profile_video_slot_limit.sql',sha256:'be8cc1c64cbde3c49ca9ee2e315d838224fe3f635e68f10f3ccd37c7096aceda'},
 {file:'20260912054100_enforce_active_nfc_sticker_capacity.sql',sha256:'2a16569db2917e4801e85718f2349b9ab8e34b11e92d3ee178164f66413419a1'},
];
test('deployed capacity migrations reject subsequent SQL alterations',async t=>{
 const current=JSON.parse(await readFile(new URL('supabase/migration-history-baseline.json',root),'utf8'));
 // Keep this historical cohort stable when future migrations are added.
 const reviewed={...current,files:current.files.filter(e=>e.file.split('_')[0]<='20260912054100')};
 const preceding={...reviewed,files:reviewed.files.filter(e=>e.file.split('_')[0]<='20260910172000')};
 assert.equal(preceding.files.length,159);assert.equal(reviewed.files.length,161);
 for(const entry of expected)assert.deepEqual(reviewed.files.find(e=>e.file===entry.file),entry);
 const parent=resolve(tmpdir());const directory=await mkdtemp(join(parent,'mydancr-capacity-history-'));assert.equal(dirname(directory),parent);
 t.after(async()=>{assert.equal(dirname(resolve(directory)),parent);await rm(directory,{recursive:true,force:true});});
 await Promise.all(reviewed.files.map(async entry=>{await writeFile(join(directory,entry.file),await readFile(new URL('supabase/migrations/'+entry.file,root),'utf8'));}));
 const initial=await verifyMigrationHistory(directory,reviewed);assert.equal(initial.ok,true,initial.errors.join('\n'));
 for(const entry of expected)await t.test(entry.file,async()=>{
  const path=join(directory,entry.file),original=await readFile(path,'utf8');
  await writeFile(path,original+'\nselect 1; -- synthetic post-deployment alteration\n');
  const old=await verifyMigrationHistory(directory,preceding);assert.equal(old.ok,true,old.errors.join('\n'));
  const protectedResult=await verifyMigrationHistory(directory,reviewed);assert.equal(protectedResult.ok,false);assert.ok(protectedResult.errors.includes('Historical SQL changed: '+entry.file+'. Add a new migration instead.'));
  await writeFile(path,original);
 });
});
