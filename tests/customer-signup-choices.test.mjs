import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { accountEntryHref } from '../src/lib/dancr/account-entry.ts';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('src/live-shell/app/14-set-venue-auth-mode.js');
function fixture(){
 const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{checked:false,disabled:true,hidden:true,value:''});return elements.get(id);}};
 const calls=[];
 let respond=async()=>({ok:true,json:async()=>({ok:true,venue:{id:'club-id',name:'Named Club'}})});
 const ctx=vm.createContext({document,authMode:'signup',customerSignupVenue:null,customerSignupVenueRequest:0,customerSignupVenueKey:'',selectedVenueName:null,resolveVenueByName:()=>({id:'selected-club'}),encodeURIComponent,
  fetch:async url=>{calls.push(url);return respond(url);}});
 vm.runInContext(source.slice(source.indexOf('    function syncCustomerSignupSharing'),source.indexOf('    function setCustomerAuthStatus')),ctx);
 return {ctx,element:id=>document.getElementById(id),calls,respond:fn=>respond=fn};
}
test('all optional signup choices are separate from required terms and start unchecked',()=>{
 const html=read('src/live-shell/shell.html');
 for(const id of ['customerEmailOptIn','customerFollowEmailOptIn','customerVenueShareOptIn']){
  const input=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(input);
  assert.doesNotMatch(input,/\b(?:checked|required)(?:\s|=|>)/);
 }
 assert.match(html,/Optional choices/);assert.match(html,/Sharing does not subscribe you to club marketing/);
});
test('general signup has no sharing recipient; named-club signup uses the validated club name',async()=>{
 const f=fixture();await f.ctx.loadCustomerSignupVenue(true);assert.equal(f.calls.length,0);assert.equal(f.element('customerVenueShareField').hidden,true);
 f.ctx.customerSignupVenueKey='named-club';await f.ctx.loadCustomerSignupVenue(true);
 assert.equal(f.element('customerVenueShareField').hidden,false);assert.equal(f.element('customerVenueShareOptIn').checked,false);
 assert.equal(f.element('customerVenueShareText').textContent,'Share my name, email, and city with Named Club.');
 assert.equal(f.element('customerShareName').required,false);
 f.element('customerVenueShareOptIn').checked=true;f.ctx.syncCustomerSignupSharing();
 assert.equal(f.element('customerShareName').required,true);assert.equal(f.element('customerVenueShareDetails').hidden,false);
});
test('switching back to login discards sharing; late lookups cannot restore it',async()=>{
 const f=fixture();f.ctx.customerSignupVenueKey='named-club';let resolve;
 f.respond(()=>new Promise(done=>resolve=done));const load=f.ctx.loadCustomerSignupVenue(true);
 f.ctx.authMode='login';await f.ctx.loadCustomerSignupVenue(false);
 resolve({ok:true,json:async()=>({ok:true,venue:{id:'old',name:'Old Club'}})});await load;
 assert.equal(f.ctx.customerSignupVenue,null);assert.equal(f.element('customerVenueShareOptIn').disabled,true);
 assert.equal(f.element('customerVenueShareField').hidden,true);
});
test('unavailable club lookup never offers sharing and signup redirects preserve only valid context',async()=>{
 const f=fixture();f.ctx.customerSignupVenueKey='missing';f.respond(async()=>{throw new Error('offline');});
 await f.ctx.loadCustomerSignupVenue(true);assert.equal(f.element('customerVenueShareField').hidden,true);
 const url=new URL(accountEntryHref({mode:'signup',signup_venue:'named-club'}),'https://example.test');
 assert.equal(url.searchParams.get('signup_venue'),'named-club');
 assert.ok(!accountEntryHref({mode:'signup',signup_venue:'https://other.test'}).includes('signup_venue'));
 assert.ok(!accountEntryHref({role:'dancer',mode:'signup',signup_venue:'named-club'}).includes('signup_venue'));
});
