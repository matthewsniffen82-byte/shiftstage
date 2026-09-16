import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pickupNotificationHref } from '../src/lib/dancr/pickup-links.ts';
import { pickupFixture,pickupId as id } from './helpers/pickup-fixture.mjs';

test('public availability requires opt-in, publication and an active venue owner; callers cannot forge the composite row',async()=>{
  const {db,asUser}=await pickupFixture(['20260914190000_club_pickup_domain.sql','20260914191000_club_pickup_security_commands.sql','20260914193000_public_club_pickup_availability.sql']);
  try {
    const available=async venue=>{await asUser(null,'anon');return (await db.query("select club_pickup_available(jsonb_populate_record(null::venues,$1::jsonb)) available",[JSON.stringify({id:id(venue),club_pickup_enabled:true,owner_user_id:id(3),is_active:true,page_review_status:'published'})])).rows[0].available;};
    assert.equal(await available(10),false); assert.equal(await available(11),false);
    await asUser(3); await db.query('select pickup_set_enabled($1,true)',[id(10)]);
    assert.equal(await available(10),true);assert.equal(await available(11),false);
    await db.exec(`reset role;update app_users set account_state='disabled' where id='${id(3)}'`);
    assert.equal(await available(10),false);
    await db.exec(`reset role;update app_users set account_state='active' where id='${id(3)}';update venues set page_review_status='venue_review' where id='${id(10)}'`);
    assert.equal(await available(10),false);
  }finally{await db.close();}
});
test('pickup notification links only accept canonical private request IDs and ignore supplied external URLs',()=>{
  assert.equal(pickupNotificationHref({kind:'club_pickup',pickupRequestId:id(20),url:'https://attacker.invalid'}),'');
  assert.equal(pickupNotificationHref({kind:'club_shuttle_request',url:'https://attacker.invalid'}),'/pickups');
  for(const value of [null,[],{}, {kind:'club_pickup',pickupRequestId:'//attacker.invalid'},{kind:'support_message',pickupRequestId:id(20)}])assert.equal(pickupNotificationHref(value),'');
});
test('venue detail never offers retired pickup chat, including stale enabled flags',()=>{
  const source=readFileSync(new URL('../src/live-shell/app/11-post-verified-shift.js',import.meta.url),'utf8');
  const declaration=source.match(/function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/)?.[0];assert.ok(declaration);
  const context=vm.createContext({citySelect:{value:'Test City'},venueDetails:v=>({...v,city:'Test City'}),venueOperatingStatus:()=>({state:'unknown'}),
    venueVisualAttrs:()=>({attrs:{className:'',style:''},source:'fixture'}),venueLogoMarkup:()=>'',venueDancers:()=>[],isFollowingVenue:()=>false,
    escapeOptionValue:String,escapeHtml:String,actionIconMarkup:()=>'',recordVenuePageEvent:()=>{},venueOfferMarkup:()=>'<div>Existing deal</div>',
    venueDirectionsMarkup:()=>'<button>Directions</button>',actionButtonLabel:(_,text)=>text,encodeURIComponent});
  vm.runInContext(declaration,context);
  for(const enabled of [undefined,false,'true'])assert.doesNotMatch(context.venueDetailPage({id:id(10),name:'Test Club',clubPickupEnabled:enabled}),/Request Club Pickup/);
  assert.doesNotMatch(context.venueDetailPage({id:id(10),name:'Test Club',clubPickupEnabled:true}),/Request Club Pickup|\/pickups\/new/);
  assert.doesNotMatch(context.venueDetailPage({id:id(10),name:'Test Club',clubPickupEnabled:true,isDashboardPreview:true}),/Request Club Pickup/);
});
