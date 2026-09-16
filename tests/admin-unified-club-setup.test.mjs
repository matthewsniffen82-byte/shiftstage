import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../app/admin/AdminClient.tsx',import.meta.url),'utf8');
const venue=ui.slice(ui.indexOf('function VenueManager('),ui.indexOf('\nfunction ',ui.indexOf('function VenueManager(')+1));
test('each club contains its scoped deal editor between media and final review',()=>{
 const media=venue.indexOf('className="venue-page-media-admin"'),contract=venue.indexOf('className="venue-commercial-setup"'),final=venue.indexOf('className="venue-page-workflow-actions"');
 assert(media>0&&contract>media&&final>contract);
 assert.doesNotMatch(venue,/ReferralFeeManager/);
 assert.match(venue,/<AdminClubDealManager scopedVenueId=\{venueId\}/);
 assert.match(venue,/openedVenues\[venueId\]/);
 const clubs=ui.slice(ui.indexOf('{workspace === "clubs" &&'),ui.indexOf('{workspace === "money" &&'));
 assert.doesNotMatch(clubs,/<AdminClubDealManager/);
});
test('embedded editors lock club selection and filter its requests',()=>{
 assert.equal((ui.match(/useState\(scopedVenueId \|\| ""\)/g)||[]).length,1);
 assert.equal((ui.match(/disabled=\{isSaving \|\| Boolean\(scopedVenueId\)\}/g)||[]).length,1);
 assert.match(ui,/asText\(request.venueId\) === scopedVenueId/);

});
test('readiness uses the current saved deal and blocks unsaved commercial changes',()=>{
 assert.match(venue,/clubDeals.some\(deal => asText\(deal.venueId\) === venueId && deal.isActive === true\)/);
 assert.doesNotMatch(venue,/Signed referral fee agreement/);
 assert.doesNotMatch(venue,/Number\(venue.active_deal_count/);
 assert.match(venue,/commercialBusy \|\| commercialDirty \|\| unsavedByVenue\[venueId\]/);
 assert.match(ui,/setIsDirty\(false\);\s+onClubDealsChange\(data.clubDeals \|\| \[\]\)/);

});
