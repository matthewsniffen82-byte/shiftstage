import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/venue.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({})});
const profile={name:'Club B',address:'123 Main Street',city:'Las Vegas',state:'NV',latitude:null,longitude:null,phone:'702-555-0123',opensAt:'18:00',closesAt:'03:00',logoImageUrl:'logo.png',isActive:false,pageReviewStatus:'venue_review'};
test('an address-only venue is ready for approval and publishing',()=>{
 const state=exports.getVenuePublicationState(profile,[{isActive:true}]);
 assert.equal(state.isReady,true);assert.equal(state.canVenueReview,true);
 assert.equal(state.requirements.some(r=>r.key==='coordinates'),false);
 assert.equal(exports.getVenuePublicationState({...profile,isActive:true},[{isActive:true}]).isReady,true);
});
test('address-only publication still requires address, logo, and an active offer',()=>{
 for(const patch of [{address:''},{logoImageUrl:null}])assert.equal(exports.getVenuePublicationState({...profile,...patch},[{isActive:true}]).isReady,false);
 assert.equal(exports.getVenuePublicationState(profile,[]).isReady,false);
});
const live=readFileSync(new URL('../outputs/index.html',import.meta.url),'utf8');
function source(name){const start=live.indexOf('    function '+name+'(');assert(start>=0);const end=live.indexOf('\n    function ',start+10);assert(end>start);return live.slice(start,end);}
function discovery(){const context=vm.createContext({distanceSelect:{value:'25 mi'},venueSelect:{value:'all'},selectedCity:()=> 'Las Vegas',ALL_CITIES:'All cities',userLocation:null,cityCoordinates:{'Las Vegas':{latitude:36.1699,longitude:-115.1398}},venueDetails:v=>v,fictionalDemoVenueTravelAddress:()=>'',actionButtonLabel:()=> 'Directions'});
 for(const name of ['liveVenueCoordinate','selectedRadiusMiles','parseMiles','hasCoordinates','distanceMilesBetween','activeDistanceOrigin','venueDistanceMiles','venueWithinSelectedRadius','selectedVenueFilter','venueMatchesCurrentFilter','escapeHtml','escapeOptionValue','venueDirectionsMarkup'])vm.runInContext(source(name),context);
 return context;
}
test('address-only venues stay in their city scroll with unknown distance, and use address directions',()=>{
 const c=discovery();const venue={id:'club-b',name:'Club B',address:'123 Main Street, Las Vegas, NV',latitude:null,longitude:null,distanceMiles:null};
 assert.equal(c.venueMatchesCurrentFilter(venue),true);assert.equal(c.venueDistanceMiles(venue),null);
 assert.match(c.venueDirectionsMarkup({venue,className:'directions'}),new RegExp(encodeURIComponent(venue.address).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.equal(c.venueMatchesCurrentFilter({...venue,latitude:5,longitude:100}),false);
});
