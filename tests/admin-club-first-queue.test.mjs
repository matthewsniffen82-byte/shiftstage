import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync('src/lib/dancr/admin.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const library={};
vm.runInNewContext(code,{exports:library,require:()=>({buildProfileReviewVersion:()=>({})})});

function database({missingVisibility=false}={}){
  const profiles=[
    {id:'waiting',stage_name:'Waiting for club',status:'pending_review',clubStatus:'pending'},
    {id:'ready',stage_name:'Club approved',status:'pending_review',clubStatus:'approved'},
    {id:'declined',stage_name:'Club declined',status:'pending_review',clubStatus:'rejected'},
    {id:'social-waiting',stage_name:'Unapproved social',status:'approved',clubStatus:'pending'},
    {id:'social-ready',stage_name:'Approved social',status:'approved',clubStatus:'approved'},
  ];
  const queries=[];
  return {profiles,queries,from(table){
    const query={table,columns:'',filters:[]};queries.push(query);
    const chain={select(columns){query.columns=columns;return chain;}};
    for(const method of ['eq','in','or','order'])chain[method]=(...args)=>{query.filters.push([method,...args]);return chain;};
    chain.then=resolve=>{
      if(table==='approval_reviews')return resolve({data:[{dancer_id:'social-waiting',review_type:'social_link:1'},{dancer_id:'social-ready',review_type:'social_link:2'}],error:null});
      if(missingVisibility&&/\bis_public\b/.test(query.columns))return resolve({data:null,error:{code:'42703',message:'is_public does not exist'}});
      let data=profiles;
      for(const [method,key,value] of query.filters){
        if(method==='eq'&&key==='club_dancer_approvals.status'){
          assert.match(query.columns,/club_dancer_approvals!inner\(status\)/);
          data=data.filter(row=>row.clubStatus===value);
        }
        if(method==='or')data=data.filter(row=>row.status==='pending_review');
        if(method==='in'&&key==='id')data=data.filter(row=>value.includes(row.id));
      }
      return resolve({data,error:null});
    };
    return chain;
  }};
}

for(const missingVisibility of [false,true])test(`staff queue waits for club approval, including pending social content and fallback=${missingVisibility}`,async()=>{
  const db=database({missingVisibility});
  const result=await library.getApprovalQueue(db);
  assert.deepEqual(Array.from(result,row=>row.id),['ready','social-ready']);
  const reads=db.queries.filter(query=>query.table==='dancer_profiles');
  assert.ok(reads.length>=2);
  assert.ok(reads.every(query=>query.filters.some(filter=>filter[1]==='club_dancer_approvals.status'&&filter[2]==='approved')));
});

test('staff directory remains available for support before the club has decided',async()=>{
  const db=database();const result=await library.getAdminDancerDirectory(db);
  assert.equal(result.length,5);assert.ok(result.some(row=>row.id==='waiting'));
  assert.ok(db.queries.every(query=>!query.columns.includes('club_dancer_approvals!inner')));
});

test('the request enters the staff queue after the club approves it',async()=>{
  const db=database();assert.equal((await library.getApprovalQueue(db)).some(row=>row.id==='waiting'),false);
  db.profiles[0].clubStatus='approved';
  assert.equal((await library.getApprovalQueue(db)).some(row=>row.id==='waiting'),true);
});
