import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { recoveryEnvelope, validateRecovery, replayRecovery, finishRecoveryCleanup } from './lib/retention-recovery.mjs';

// This command never initiates a provider restore or enables public access.
// Export must be kept outside the application repository and outside the restored database.
try {
 const args=process.argv.slice(2), mode=args[0];
 const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
 const file=option(mode==='export'?'--output':'--input');
 if(!['export','replay'].includes(mode)||!file||!path.isAbsolute(file))throw new Error('Use export --output ABSOLUTE_PRIVATE_PATH or replay --input ABSOLUTE_PRIVATE_PATH --target-ref REF --restore-point ISO --isolated.');
 const relative=path.relative(process.cwd(),file);
 if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('Recovery evidence must stay outside the repository.');
 nextEnv.loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 // Replay credentials are deliberately separate from the app's production credentials.
 const url=mode==='replay'?process.env.RETENTION_RESTORE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=mode==='replay'?process.env.RETENTION_RESTORE_SERVICE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error('Required maintenance credentials are unavailable.');
 const project=new URL(url).hostname.split('.')[0];
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
 if(mode==='export'){
  const r=await db.rpc('export_deletion_recovery',{p_lease:randomUUID()});
  if(r.error||!r.data)throw new Error('Fresh export unavailable.');
  await writeFile(file,JSON.stringify(recoveryEnvelope(r.data,project),null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({ok:true,exportedAt:r.data.exportedAt,throughSequence:r.data.throughSequence,output:file}));
 }else{
  if(project!==option('--target-ref'))throw new Error('Restored target does not match the explicit target reference.');
  const envelope=JSON.parse(await readFile(file,'utf8'));
  const snapshot=validateRecovery(envelope,{targetProject:project,restorePoint:option('--restore-point'),isolated:args.includes('--isolated')});
  const frozen=Date.parse(option('--source-frozen-at'));
  if(!Number.isFinite(frozen)||frozen<Date.parse(option('--restore-point'))||frozen>Date.parse(snapshot.exportedAt))throw new Error('Provide --source-frozen-at ISO: stop source writes before the final export. An older export cannot confirm subsequent deletions.');
  const result=await replayRecovery(db,snapshot);
  // Re-run original deadlines too; copying/restoring data never resets them.
  const cleanup=await finishRecoveryCleanup(db);
  await writeFile(file+'.replay-receipt.json',JSON.stringify({verifiedAt:new Date().toISOString(),targetProject:project,restorePoint:option('--restore-point'),sourceFrozenAt:option('--source-frozen-at'),...result,...cleanup},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({ok:true,...result,storageAndProviderReviewRequired:true}));
 }
}catch(error){
 // Only locally authored messages are exposed; provider errors are replaced above.
 console.error(JSON.stringify({ok:false,error:error instanceof Error&&error.message.length<240?error.message:'Recovery did not complete. Keep the target isolated.'}));
 process.exitCode=1;
}
