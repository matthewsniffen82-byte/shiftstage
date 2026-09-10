import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

export const webhookSchema=JSON.parse(readFileSync(new URL('../fixtures/payment-webhook-attempt-schema.json',import.meta.url),'utf8'));
export const webhookMigrationPath='supabase/migrations/20260910091000_add_payment_webhook_attempt_receipts.sql';
export const webhookMigration=readFileSync(new URL('../../'+webhookMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const webhookSignature='public.claim_payment_webhook_attempt(text,text,text,text)';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createWebhookAttemptDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls');
  const columns=webhookSchema.columns.map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
  await pg.exec('create table public.payment_provider_webhook_events('+columns.join(',')+');alter table public.payment_provider_webhook_events enable row level security');
  for(const r of webhookSchema.constraints)await pg.exec('alter table public.payment_provider_webhook_events add constraint '+quote(r.name)+' '+r.definition);
  const names=new Set(webhookSchema.constraints.map(r=>r.name));
  for(const r of webhookSchema.indexes)if(!names.has(r.name))await pg.exec(r.definition);
  for(const r of webhookSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  await pg.exec(webhookSchema.existing_function.definition);
  assert.equal((await pg.query("select md5(pg_get_functiondef('public.claim_payment_provider_webhook(text,text,text,text)'::regprocedure)) hash")).rows[0].hash,webhookSchema.existing_function.fingerprint);
  await pg.exec('revoke all on function public.claim_payment_provider_webhook(text,text,text,text) from public,anon,authenticated;grant execute on function public.claim_payment_provider_webhook(text,text,text,text) to service_role;grant usage on schema public to anon,authenticated,service_role;grant select on public.payment_provider_webhook_events to anon,authenticated;grant all on public.payment_provider_webhook_events to service_role');
  // The existing admin SELECT policy is audited separately; synthetic browser roles have no admin identity.
  if(migrate)await pg.exec(webhookMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedWebhookAttemptDatabase(pg){
 await pg.exec("reset role;set timezone='UTC';drop trigger if exists synthetic_failure on public.payment_provider_webhook_events;truncate public.payment_provider_webhook_events");
 await pg.exec(webhookSchema.existing_function.definition);
 await pg.exec('set role service_role');
}
export async function claimWebhookAttempt(pg,{provider='stripe',eventId='evt_synthetic',eventType='invoice.paid',objectId='in_synthetic'}={}){
 return (await pg.query('select public.claim_payment_webhook_attempt($1,$2,$3,$4) receipt',[provider,eventId,eventType,objectId])).rows[0].receipt;
}
export async function webhookSnapshot(pg){return (await pg.query('select to_jsonb(t) row from public.payment_provider_webhook_events t order by id')).rows.map(r=>r.row);}
