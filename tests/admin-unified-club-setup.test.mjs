import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../app/admin/AdminClient.tsx',import.meta.url),'utf8');
const venue=ui.slice(ui.indexOf('function VenueManager('),ui.indexOf('\nfunction ',ui.indexOf('function VenueManager(')+1));
test('each club contains its scoped agreement and deal editors between media and final review',()=>{
 const media=venue.indexOf('className="venue-page-media-admin"'),contract=venue.indexOf('className="venue-commercial-setup"'),final=venue.indexOf('className="venue-page-workflow-actions"');
 assert(media>0&&contract>media&&final>contract);
 assert.match(venue,/<ReferralFeeManager scopedVenueId=\{venueId\}/);
 assert.match(venue,/<AdminClubDealManager scopedVenueId=\{venueId\}/);
 assert.match(venue,/openedVenues\[venueId\]/);
 const clubs=ui.slice(ui.indexOf('{workspace === "clubs" &&'),ui.indexOf('{workspace === "money" &&'));
 assert.doesNotMatch(clubs,/<AdminClubDealManager/);
});
test('embedded editors lock club selection and filter its contract history and requests',()=>{
 assert.equal((ui.match(/useState\(scopedVenueId \|\| ""\)/g)||[]).length,2);
 assert.equal((ui.match(/disabled=\{isSaving \|\| Boolean\(scopedVenueId\)\}/g)||[]).length,2);
 assert.match(ui,/asText\(request.venueId\) === scopedVenueId/);
 assert.match(ui,/asText\(term.venueId\) === scopedVenueId/);
 assert.match(ui,/admin-referral-fee-form-\$\{scopedVenueId \|\| "all"\}/);
});
test('readiness uses the current saved deal and agreement and blocks unsaved commercial changes',()=>{
 assert.match(venue,/clubDeals.some\(deal => asText\(deal.venueId\) === venueId && deal.isActive === true\)/);
 assert.match(venue,/label: "Signed referral fee agreement"/);
 assert.doesNotMatch(venue,/Number\(venue.active_deal_count/);
 assert.match(venue,/commercialBusy \|\| commercialDirty \|\| unsavedByVenue\[venueId\]/);
 assert.match(ui,/setIsDirty\(false\);\s+onClubDealsChange\(data.clubDeals \|\| \[\]\)/);
 assert.match(ui,/setIsDirty\(false\);\s+onReferralFeesChange\(data.referralFees\)/);
});
