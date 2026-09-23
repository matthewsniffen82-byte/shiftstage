import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { evaluateMediaBranding, parseMediaBrandingAnalysis, MEDIA_BRANDING_RULES } from '../src/lib/dancr/media-branding-policy.ts';
import { applyDancerPhotoContentPolicy } from '../src/lib/dancr/photo-content-policy-core.ts';

const source=readFileSync(new URL('../src/lib/dancr/video-moderation.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('video.ts',source,ts.ScriptTarget.Latest,true);
const names=['moderateStoredMyDancrTvVideo','combineVideoDecisions','strongestDecision','uniqueReasonCodes','maximumCategoryScores','classifyVideoPolicy'];
const selected=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const compiled=ts.transpileModule(selected+'\nexport {moderateStoredMyDancrTvVideo,classifyVideoPolicy};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const generic={decision:'approved',reasonCodes:[],categoryScores:{},providerFlagged:false};
const clear={nudity:'absent',sexualActivity:'absent',decision:'approved',reasonCodes:['safe_adult_promotional_content'],confidence:0.99,branding:'absent',brandingConfidence:0.99};
function runtime(analysis){
 const exports={},deleted=[];
 vm.runInNewContext(compiled,{exports,Buffer,console:{info(){}},getServerEnv:()=>'',createOpenAIClient:async()=>({}),
  mkdtemp:async()=>'/synthetic',path:{join:(...parts)=>parts.join('/')},tmpdir:()=>'/tmp',writeFile:async()=>{},
  rm:async p=>deleted.push(p),downloadVideo:async()=>Buffer.from('video'),assertAllowedVideoContainer(){},
  probeVideoDurationSeconds:async()=>30,extractVideoFrames:async()=>[Buffer.from('frame')],extractOptionalAudio:async()=>null,
  runVideoReviewChecks:async()=>({frameResults:[{}],textResult:{},policyDecision:analysis,identityAnalysis:{personCount:1,personCountConfidence:.99,singlePersonOnly:true}}),
  evaluateDancrImageModeration:()=>generic,evaluateDancerMediaIdentity:()=>generic,
  evaluateMediaBranding,parseMediaBrandingAnalysis,DANCR_IMAGE_MODERATION_MODEL:'synthetic',VIDEO_POLICY_MODEL:'synthetic',DANCR_MEDIA_IDENTITY_MODEL:'synthetic',
  VIDEO_POLICY_APPROVE_CONFIDENCE:.75,VIDEO_POLICY_REJECT_CONFIDENCE:.95,
  withTimeout:fn=>fn({}),OPENAI_TIMEOUT_MS:1000,DANCER_MEDIA_CONTENT_RULES:MEDIA_BRANDING_RULES,
  VIDEO_POLICY_REASON_CODES:['safe_adult_promotional_content','visible_branding_or_logo','branding_or_logo_uncertain'],
 });
 return {exports,deleted};
}
for(const [branding,brandingConfidence,decision] of [['present',.99,'rejected'],['present',.95,'rejected'],['present',.94,'review'],['uncertain',1,'review'],['absent',.94,'review'],['absent',.99,'approved']]){
 test(`${branding} branding at ${brandingConfidence} independently produces ${decision} in photos and videos`,async()=>{
  const analysis={...clear,branding,brandingConfidence};
  assert.equal(evaluateMediaBranding(analysis).decision,decision);
  assert.equal(applyDancerPhotoContentPolicy(generic,analysis).decision,decision);
  const r=runtime(analysis),result=await r.exports.moderateStoredMyDancrTvVideo({}, {videoId:'synthetic',storagePath:'synthetic',storageMime:'video/mp4',caption:''});
  assert.equal(result.decision,decision);assert.equal(result.details.branding,branding);
  assert.equal(result.categoryScores.branding_confidence,brandingConfidence);
  assert.ok(result.reasonCodes.includes(evaluateMediaBranding(analysis).reasonCode));assert.equal(r.deleted.length,1);
 });
}
test('an overall rejection with questionable branding alone still goes to a human',async()=>{
 const analysis={...clear,decision:'rejected',reasonCodes:['branding_or_logo_uncertain'],branding:'uncertain',brandingConfidence:1};
 assert.equal(applyDancerPhotoContentPolicy(generic,analysis).decision,'review');
 const r=runtime(analysis);assert.equal((await r.exports.moderateStoredMyDancrTvVideo({}, {storageMime:'video/mp4'})).decision,'review');
});
test('malformed or missing findings cannot approve photos or videos',async()=>{
 for(const fields of [{branding:undefined},{branding:'clear'},{branding:false},{brandingConfidence:undefined},{brandingConfidence:'1'},...[NaN,Infinity,-1,1.1].map(brandingConfidence=>({brandingConfidence}))]){
  const analysis={...clear,...fields};
  assert.throws(()=>parseMediaBrandingAnalysis(analysis),/provider_response_incomplete/);
  assert.throws(()=>applyDancerPhotoContentPolicy(generic,analysis),/provider_response_incomplete/);
  const r=runtime(analysis);await assert.rejects(r.exports.moderateStoredMyDancrTvVideo({}, {storageMime:'video/mp4'}),/provider_response_incomplete/);
 }
});
test('a missing branding response from the video provider stops classification',async()=>{
 const r=runtime(clear),client={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({decision:'approved',reason_codes:['safe_adult_promotional_content'],confidence:.99})}}]})}}};
 await assert.rejects(r.exports.classifyVideoPolicy(client,[Buffer.from('frame')],'',''),/provider_response_incomplete/);
});
test('no club, clothing, watermark, ownership, or incidental-brand exemption remains',()=>{
 const rules=MEDIA_BRANDING_RULES.join(' ');
 for(const term of ['venue/club logos','clothing','watermarks','ownership','Incidental','Uploaded MyDancr marks'])assert.ok(rules.includes(term));
 assert.match(rules,/ordinary shape, plain pattern, or generic text/);
});
