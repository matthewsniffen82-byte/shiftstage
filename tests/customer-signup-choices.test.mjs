import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { accountEntryHref } from '../src/lib/dancr/account-entry.ts';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('signup offers two unchecked optional email choices separate from required terms',()=>{
 const html=read('src/live-shell/shell.html');
 const choices=html.match(/<fieldset id="customerSignupChoices"[\s\S]*?<\/fieldset>/)?.[0];
 assert.ok(choices);assert.equal((choices.match(/type="checkbox"/g)||[]).length,2);
 for(const id of ['customerEmailOptIn','customerFollowEmailOptIn']){
  const input=choices.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(input);
  assert.doesNotMatch(input,/\b(?:checked|required)(?:\s|=|>)/);
 }
 assert.match(html,/id="customerTermsAccepted"/);
 assert.match(choices,/Email is optional/);
 assert.match(choices,/in-app updates from dancers and clubs you follow/);
 assert.ok(choices.indexOf('customerSignupDeliveryNote')<choices.indexOf('customerFollowEmailOptInField'));
 assert.match(read('src/live-shell/app/14-set-venue-auth-mode.js'),/termsInput\.required = isSignup/);
});

test('general and club-linked signup no longer collect contact-sharing choices',()=>{
 const files=['shell.html','app/01-user-agent.js','app/13-open-profile-modal.js','app/14-set-venue-auth-mode.js','app/24-events.js','app/26-sync-discovery-city-scope.js'];
 for(const file of files)assert.doesNotMatch(read('src/live-shell/'+file),/customerVenueShare|customerShareName|customerShareCity|customerSignupVenue|loadCustomerSignupVenue|syncCustomerSignupSharing/);
 // Old club links still resolve safely, without recreating signup sharing.
 const url=new URL(accountEntryHref({mode:'signup',signup_venue:'named-club'}),'https://example.test');
 assert.equal(url.searchParams.get('auth'),'signup');
 assert.ok(!accountEntryHref({mode:'signup',signup_venue:'https://other.test'}).includes('signup_venue'));
});

test('guest-list and pickup forms retain their own required sharing confirmations and optional marketing',()=>{
 const form=read('app/deals/transportation/[dealId]/TransportationClient.tsx');
 const pickup=form.split('\n').find(line=>line.includes('name="handoffAccepted"'));
 const guest=form.split('\n').find(line=>line.includes('name="guestConsent"'));
 for(const field of [pickup,guest]) { assert.ok(field);assert.match(field,/type="checkbox"/);assert.match(field,/\brequired\b/); }
 assert.match(pickup,/I agree to share my details with \{venue.name\} to arrange pickup/);
 assert.match(guest,/I agree to share my details with \{venue.name\} for the guest list/);
 assert.match(read('app/components/VenueUpdateOptIns.tsx'),/Neither is required for entry or a ride/);
});
