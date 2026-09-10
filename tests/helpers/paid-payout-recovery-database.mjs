import {readFileSync} from 'node:fs';
import {createPayoutRequestDatabase,seedPayoutRequestDatabase,requestPayout,payoutRequestSnapshot,payoutId} from './payout-request-database.mjs';
export {payoutRequestSnapshot as recoverySnapshot,payoutId};
export const recoveryMigrationPath='supabase/migrations/20260910160000_add_atomic_paid_payout_recovery.sql';
export const recoveryMigration=readFileSync(new URL('../../'+recoveryMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const recoverySignature='public.flag_paid_payout_recovery_safely(uuid,text,text)';
export async function createPaidRecoveryDatabase({migrate=true}={}){const pg=await createPayoutRequestDatabase();try{if(migrate)await pg.exec(recoveryMigration);return pg;}catch(error){await pg.close();throw error;}}
export async function seedPaidRecoveryDatabase(pg,{extraEarning=false}={}){
 await pg.exec('reset role;alter table commission_events enable trigger commission_events_prepare_earning');
 await seedPayoutRequestDatabase(pg);
 if(extraEarning){
  await pg.query('insert into qr_redemptions(id) values($1)',[payoutId(3)]);
  await pg.query("insert into deal_revenue_events values($1,$2,true,'2020-01-01','2020-01-02',2000,'settled')",[payoutId(3),payoutId(1)]);
  await pg.query("insert into commission_events(id,qr_redemption_id,venue_id,club_deal_id,dancer_id,status,amount_cents) values($1,$2,$3,$3,$3,'available',2000)",[payoutId(23),payoutId(3),payoutId(1)]);
 }
 const payout=await requestPayout(pg),reference='tr_paid_recovery_synthetic';
 await pg.query('select public.mark_dancer_payout_processing($1,$2)',[payout.id,reference]);
 await pg.query("select public.complete_dancer_payout_batch($1,$2,'2020-01-02T00:00:00Z')",[payout.id,reference]);
 return {id:payout.id,reference};
}
export async function flagPaidRecovery(pg,{id,reference,reason='Synthetic provider reversal'}){
 return (await pg.query('select public.flag_paid_payout_recovery_safely($1,$2,$3) receipt',[id,reference,reason])).rows[0].receipt;
}
