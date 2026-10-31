import { createHash } from 'node:crypto';
import { processRetentionMedia, retentionObjectFamily } from '../../src/lib/dancr/retention-storage.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function recoveryEnvelope(snapshot, sourceProject) {
 const body=JSON.stringify(snapshot);
 return {version:1,sourceProject,sha256:createHash('sha256').update(body).digest('hex'),snapshot};
}

export function validateRecovery(envelope, { targetProject, restorePoint, isolated }, now=Date.now()) {
 if(!isolated || !targetProject || targetProject===envelope?.sourceProject) throw new Error('Recovery replay requires a different, isolated restored project. Production replay is disabled.');
 const s=envelope?.snapshot;
 if(envelope?.version!==1 || !/^[a-z]{20}$/.test(envelope.sourceProject||'') || !/^[a-z]{20}$/.test(targetProject)) throw new Error('Invalid project identity.');
 if(!s || s.version!==1 || createHash('sha256').update(JSON.stringify(s)).digest('hex')!==envelope.sha256) throw new Error('Recovery export checksum mismatch.');
 const at=Date.parse(restorePoint), exported=Date.parse(s.exportedAt), start=Date.parse(s.coverageStartedAt);
 if(!Number.isFinite(at)||!Number.isFinite(exported)||!Number.isFinite(start)||at<start||at>exported||exported>now||at<now-90*86400000) throw new Error('Restore point is outside recorded deletion coverage. Do not reopen the restored project.');
 if(!Array.isArray(s.ledger)||!Array.isArray(s.media)||!Number.isSafeInteger(s.throughSequence)) throw new Error('Incomplete recovery export.');
 for(const e of s.ledger){
  if(!['public','auth'].includes(e.source_schema)||!/^[a-z][a-z0-9_]+$/.test(e.source_table)||!e.record_key||Array.isArray(e.record_key)
   || !Object.keys(e.record_key).length ||Object.values(e.record_key).some(v=>v===null||typeof v==='object')
   ||!['delete','clear'].includes(e.operation)||!Array.isArray(e.cleared_columns)
   || !Number.isFinite(Date.parse(e.deleted_at))||Date.parse(e.deleted_at)>exported||e.sequence>s.throughSequence
   ||e.source_schema==='auth'&&(e.source_table!=='users'||e.operation!=='delete'||!UUID.test(e.record_key.id))) throw new Error('Invalid recovery entry.');
 }
 for(const job of s.media){
  retentionObjectFamily(job);
  if(!Number.isFinite(Date.parse(job.trigger_at))||Date.parse(job.trigger_at)>exported||
   job.completed_at&&(!Number.isFinite(Date.parse(job.completed_at))||Date.parse(job.completed_at)>exported))throw new Error('Invalid media recovery clock.');
 }
 return s;
}

export async function replayRecovery(db, snapshot) {
 const isolation=await db.rpc('assert_retention_restore_isolated');
 if(isolation.error||isolation.data!==true)throw new Error('Ordinary database API roles still have access. Quarantine the restored target first.');
 // Restored FK links must be cleared before their referenced accounts can be removed.
 for(const e of snapshot.ledger.filter(e=>e.operation==='clear')){
  if(e.source_schema!=='public') throw new Error('Unsupported recovery clear.');
  const r=await db.rpc('reapply_cleared_fields',{p_table:e.source_table,p_key:e.record_key,p_columns:e.cleared_columns,p_deleted_at:e.deleted_at});
  if(r.error) throw new Error('Recovery field removal failed. Keep the project isolated.');
  let q=db.from(e.source_table).select(e.cleared_columns.join(','));
  for(const [k,v]of Object.entries(e.record_key))q=q.eq(k,v);
  const readback=await q.maybeSingle();
  if(readback.error||readback.data&&e.cleared_columns.some(k=>readback.data[k]!==null))throw new Error('Recovered field removal was not confirmed.');
 }
 let pending=snapshot.ledger.filter(e=>e.operation==='delete'), removed=0;
 for(let pass=0;pending.length&&pass<20;pass++){
  const retry=[];let progress=0;
  for(const e of pending){
   let error;
   if(e.source_schema==='auth'){
    const r=await db.auth.admin.deleteUser(e.record_key.id);error=r.error;
    if(error?.status===404)error=null;
   }else{
    const r=await db.rpc('reapply_deleted_record',{p_schema:e.source_schema,p_table:e.source_table,p_key:e.record_key,p_deleted_at:e.deleted_at});error=r.error;
   }
   if(error)retry.push(e);else{progress++;removed++;}
  }
  if(!progress&&retry.length)throw new Error('Recovery has unresolved references. Keep the project isolated.');
  pending=retry;
 }
 if(pending.length)throw new Error('Recovery did not finish. Keep the project isolated.');
 // Read-back confirms no deleted primary key remains. A successful DELETE response alone is insufficient.
 for(const e of snapshot.ledger.filter(e=>e.operation==='delete')){
  if(e.source_schema==='auth'){
   const r=await db.auth.admin.getUserById(e.record_key.id);
   if(r.data?.user || r.error&&r.error.status!==404)throw new Error('Restored login absence is unconfirmed.');
   const normalized=await db.from('deletion_recovery_ledger').update({deleted_at:e.deleted_at})
    .eq('source_schema','auth').eq('source_table','users').contains('record_key',e.record_key).gt('deleted_at',e.deleted_at);
   if(normalized.error)throw new Error('Original account deletion clock was not preserved.');
  }else{
   let q=db.from(e.source_table).select('*',{count:'exact',head:true});
   for(const [k,v] of Object.entries(e.record_key))q=q.eq(k,v);
   const r=await q;if(r.error||r.count!==0)throw new Error('Restored record absence is unconfirmed.');
  }
 }
 for(const job of snapshot.media){
  const imported=await db.rpc('reapply_retention_media',{p_job:job});
  if(imported.error||imported.data!==true)throw new Error('Media recovery import failed. Keep the project isolated.');
 }
 return {removedEntries:removed,clearedEntries:snapshot.ledger.filter(e=>e.operation==='clear').length,mediaReferences:snapshot.media.length,publicAccessEnabled:false};
}

export async function finishRecoveryCleanup(db) {
 // More than one bounded batch may be needed; never report a partial drain as complete.
 for(let batch=0;batch<1000;batch++){
  const sweep=await db.rpc('run_lifecycle_retention');
  if(sweep.error||sweep.data?.status!=='completed')throw new Error('Restored retention sweep is unconfirmed. Keep the project isolated.');
  const media=await processRetentionMedia(db);
  if(media.failed)throw new Error('Restored media cleanup failed. Keep the project isolated.');
  const preview=await db.rpc('preview_lifecycle_retention');
  if(preview.error||!Array.isArray(preview.data?.sources)||!Array.isArray(preview.data?.media))throw new Error('Restored cleanup readback unavailable.');
  const due=preview.data.sources.filter(row=>row.due>0);
  if(due.some(row=>row.blocker))throw new Error('A preservation or policy decision blocks recovered data. Keep the project isolated.');
  const pending=preview.data.media.filter(row=>row.state!=='completed').reduce((n,row)=>n+row.count,0);
  if(!due.length&&!pending)return {sweepBatches:batch+1,mediaPending:0};
  if(!due.length&&pending&&!media.completed)throw new Error('Recovered media remains referenced, restricted or awaiting retry. Keep the project isolated.');
 }
 throw new Error('Recovery batch limit reached. Keep the project isolated and resume cleanup.');
}
