import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileRoute = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("legacy venue URLs resolve real production data before redirecting to the canonical in-app profile", () => {
  assert.match(profileRoute, /getVenueProfile\(createAdminSupabaseClient\(\), slug\)/);
  assert.match(profileRoute, /if \(!venue\) notFound\(\)/);
  assert.match(
    profileRoute,
    /permanentRedirect\([\s\S]*?city=\$\{encodeURIComponent\(venue\.city \|\| "Las Vegas"\)\}&venue=\$\{encodeURIComponent\(venue\.slug\)\}/,
  );
  assert.doesNotMatch(
    profileRoute,
    /PublicProfileHeader|FloatingProfileHomeLink|VenueProfileActions|ClubDealCard|TvVideoStrip/,
  );
});

test("the canonical in-app venue page is dedicated to the selected club and its live production data", () => {
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueDetail, /venueDancers\(city, venue\.name\)/);
  assert.match(
    venueDetail,
    /const tonight = localProfiles[\s\S]*?isWorkingTonight\(profile\)[\s\S]*?const upcoming = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && profile\.scheduled/,
  );
  assert.match(venueDetail, /recordVenuePageEvent\(\{ venueId: venue\.id, eventType: "page_view", source: "venue_page" \}\)/);
  assert.match(venueDetail, /venueOfferMarkup\(venue\)/);
  assert.doesNotMatch(venueDetail, /\/api\/public\/maps\/embed\?address=|<iframe/i);
  assert.match(venueDetail, /const venueValue = escapeOptionValue\(venue\.name\)/);
  assert.match(venueDetail, /class="venue-secondary-actions"[\s\S]*?class="action-btn secondary follow-venue-btn[\s\S]*?data-venue-follow="\$\{venueValue\}"[\s\S]*?class="action-btn secondary venue-detail-share"[\s\S]*?data-share-venue="\$\{venueValue\}"/);
  assert.match(venueDetail, /venueDirectionsMarkup\(\{ venue, className: "venue-address-directions", city \}\)/);
  assert.match(venueDetail, /class="venue-identity-meta"[\s\S]*?class="venue-identity-location"><span class="meta">[\s\S]*?details\.city[\s\S]*?details\.state[\s\S]*?venue-identity-distance[\s\S]*?details\.distanceLabel/);
  assert.match(venueDetail, /details\.address \? `<div class="venue-address-line"><span>[\s\S]*?escapeHtml\(details\.address\)[\s\S]*?: ""/);
  assert.equal((venueDetail.match(/actionIconMarkup\("pin"\)/g) || []).length, 0);
  assert.equal((venueDetail.match(/venueDirectionsMarkup\(/g) || []).length, 1);
  assert.doesNotMatch(venueDetail, /Address unavailable|venue-address-tile-no-address/);
  assert.equal((venueDetail.match(/encodeURIComponent\(details\.address\)/g) || []).length, 0);
  assert.match(liveApp, /function venueDirectionsMarkup[\s\S]*?https:\/\/maps\.google\.com\/\?q=\$\{encodeURIComponent\(destinationAddress\)\}/);
  assert.doesNotMatch(venueDetail, /<div class="info-tile"><strong>Distance<\/strong>/);
  assert.doesNotMatch(venueDetail, /details\.description|venue-confirmed shifts|nightlife venue in/);
  assert.doesNotMatch(venueDetail, /<div class="info-tile"><strong>Hours/);
  assert.match(venueDetail, /Working now at \$\{escapeHtml\(details\.name\)\}/);
  assert.match(venueDetail, /const operatingSummaryLabel = operatingStatus\.state === "unknown"[\s\S]*?\? "Not posted"[\s\S]*?: operatingStatus\.label/);
  assert.match(venueDetail, /venue-operating-status is-\$\{operatingStatus\.state\}">\$\{escapeHtml\(operatingSummaryLabel\)\}/);
  assert.match(venueDetail, /data-venue-jump="venue-upcoming-shifts"[\s\S]*?<span>upcoming<\/span>/);
  assert.match(venueDetail, /id="venue-upcoming-shifts"[\s\S]*?<span>Upcoming at \$\{escapeHtml\(details\.name\)\}<\/span><span class="venue-activity-count" aria-hidden="true">\$\{upcoming\.length\}<\/span>/);
  assert.match(venueDetail, /class="venue-status-grid" aria-label="Tonight at \$\{escapeHtml\(details\.name\)\}"[\s\S]*?venue-operating-summary[\s\S]*?venue-status-kicker">Hours[\s\S]*?\$\{quickStats\}/);
  assert.match(venueDetail, /class="venue-info venue-location-section"[\s\S]*?class="venue-location-actions venue-primary-actions"[\s\S]*?venue-address-directions[\s\S]*?\$\{rideMarkup\}/);
  assert.ok(venueDetail.indexOf("${venueOfferMarkup(venue)}") < venueDetail.indexOf("${activitySections}"));
  assert.ok(venueDetail.indexOf("${activitySections}") < venueDetail.indexOf("venue-location-section"));
  assert.ok(venueDetail.indexOf("venue-location-section") < venueDetail.indexOf("venue-secondary-actions"));
  assert.doesNotMatch(liveApp, /function fictionalVenueContactDetails\(/);
  assert.doesNotMatch(venueDetail, /venueInformationRows|venueInformationMarkup|venue-information-section|venue-information-heading|venue-contact-details-content/);
  assert.equal((venueDetail.match(/venue-status-kicker">Hours/g) || []).length, 1);
  assert.doesNotMatch(venueDetail, /details\.(?:phone|website)|venuePhoneHref|venueWebsiteHref|href="tel:|venue-contact-link|<strong>(?:Phone|Website)<\/strong>/);
  assert.doesNotMatch(venueDetail, /<details|<summary/);
  assert.match(venueDetail, /<\/article>[\s\S]*?<div class="venue-detail-exploration">[\s\S]*?\$\{activitySections\}[\s\S]*?class="venue-info venue-location-section"/);
  assert.match(venueDetail, /class="venue-action-stack"[\s\S]*?class="venue-location-actions venue-primary-actions"[\s\S]*?class="venue-secondary-actions"/);
  assert.equal((venueDetail.match(/\$\{rideMarkup\}/g) || []).length, 1);
  assert.match(venueDetail, /id="venue-no-shift-posted"[\s\S]*?<span>No Shift Posted<\/span>/);
  assert.doesNotMatch(venueDetail, /Trending at|is-trending/);
  assert.doesNotMatch(venueDetail, /verified shifts/i);
  assert.doesNotMatch(
    venueDetail,
    /otherVenues|Other \$\{city\} venues|other venues|venueCard\(item\)/i,
  );
});

test("venue hours appear once in the summary without a duplicate information section", () => {
  const venueDetails = liveApp.match(
    /function venueDetails\(venue, city\) \{[\s\S]*?(?=\n    function venueOperatingStatus)/,
  )?.[0] || "";
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?(?=\n    function findProfile)/,
  )?.[0] || "";

  assert.doesNotMatch(venueDetails, /phone:|website:|fictionalContact/);
  assert.equal((venueDetail.match(/venue-status-kicker">Hours/g) || []).length, 1);
  assert.match(venueDetail, /venue-operating-status[\s\S]*?operatingStatus\.hoursLabel/);
  assert.doesNotMatch(venueDetail, /Venue information|venue-information-heading|<strong>Hours<\/strong>/);
  assert.doesNotMatch(venueDetail, /<strong>Phone<\/strong>|<strong>Website<\/strong>|href="tel:|target="_blank"/);
});

test("venue details reuse the production Dancers grid card for every schedule status", () => {
  const venueGrid = liveApp.match(
    /function venueDancerGridMarkup\(profiles, city, label\) \{[\s\S]*?(?=\n    function venueDetailPage)/,
  )?.[0] || "";
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?(?=\n    function findProfile)/,
  )?.[0] || "";
  const sharedCard = liveApp.match(
    /function homeDancerGridCard\(profile, city, compactDirectory = false, imageIndex = 0\) \{[\s\S]*?(?=\n    function homeDancerGridSectionMarkup)/,
  )?.[0] || "";

  assert.match(venueGrid, /class="venue-dancer-grid home-dancer-grid home-dancer-three-column"/);
  assert.match(venueGrid, /profiles\.map\(\(profile\) => homeDancerGridCard\(profile, city, true\)\)/);
  assert.match(venueDetail, /const tonight = localProfiles[\s\S]*?isWorkingTonight\(profile\)/);
  assert.match(venueDetail, /const upcoming = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && profile\.scheduled/);
  assert.match(venueDetail, /const noSchedule = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && !profile\.scheduled/);
  assert.equal((venueDetail.match(/venueDancerGridMarkup\(/g) || []).length, 3);
  assert.doesNotMatch(venueDetail, /profileCard\(|venueUpcomingShiftRow\(|venue-shift-row|venue-shift-list/);
  assert.match(sharedCard, /homeDiscoveryFeedStatus\(profile\)[\s\S]*?homeDancerGridScheduleLabel\(profile, city\)/);
  assert.match(sharedCard, /groupClass = status\.className === "is-now"[\s\S]*?"is-upcoming"[\s\S]*?"is-open"/);
  assert.match(sharedCard, /class="dancer-card home-dancer-grid-card \$\{groupClass\}/);
  assert.match(sharedCard, /href="\$\{profileHref\}"[\s\S]*?aria-label="Open \$\{safeName\}'s full profile"/);
  assert.match(liveApp, /Venue detail uses the exact same compact production profile tiles[\s\S]*?\.venue-dancer-grid \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  const venueCardRule = liveApp.match(/\.venue-dancer-grid > \.home-dancer-grid-card \{[^}]*\}/)?.[0] || "";
  assert.match(venueCardRule, /aspect-ratio: 9 \/ 16 !important;/);
  assert.match(venueCardRule, /contain: layout style;/);
  assert.doesNotMatch(venueCardRule, /contain: layout paint style;/);
  assert.match(liveApp, /\.venue-dancer-grid img\.home-dancer-grid-photo \{[\s\S]*?display: block !important;[\s\S]*?object-fit: cover;[\s\S]*?object-position: center top;/);
  assert.match(
    liveApp,
    /@media \(max-width: 420px\) \{[\s\S]*?\.venue-dancer-grid \{[\s\S]*?width: calc\(100% \+ 16px\) !important;[\s\S]*?margin-inline: -8px !important;[\s\S]*?padding-right: max\(12px, env\(safe-area-inset-right, 0px\)\) !important;[\s\S]*?gap: 2px !important;/,
  );
  assert.match(
    liveApp,
    /Venue-profile portraits use the same normal mobile paint flow[\s\S]*?@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.venue-dancer-grid > \.home-dancer-grid-card,[\s\S]*?\.venue-dancer-grid \.home-dancer-grid-link,[\s\S]*?\.venue-dancer-grid \.home-dancer-grid-photo \{[\s\S]*?animation: none !important;[\s\S]*?will-change: auto !important;[\s\S]*?backface-visibility: visible !important;/,
  );
});

test("venue profiles reserve customer Club Deal language for active offers", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";
  assert.match(
    venueOffer,
    /venue\?\.activeDeal[\s\S]*?venue-deal-preview is-active-club-deal[\s\S]*?<button class="venue-detail-club-deal-cta"[\s\S]*?data-club-deal-cta="\$\{encodeDealPass\(config\)\}"[\s\S]*?Club Deal/,
  );
  assert.equal((venueOffer.match(/data-club-deal-cta=/g) || []).length, 1);
  assert.match(venueOffer, /activeDealCount[\s\S]*?hasMultipleActiveDeals[\s\S]*?\$\{activeDealCount\} Club Deals[\s\S]*?Open \$\{activeDealCount\} Club Deals[\s\S]*?hasMultipleActiveDeals \? "Club Deals" : "Club Deal"/);
  assert.match(venueOffer, /customerFacingDealDescription\(venue\.activeDeal\.dealDescription\)/);
  assert.match(venueOffer, /return "";/);
  assert.doesNotMatch(venueOffer, /Half-off admission|Skip the line|Tap at cashier/);
  assert.doesNotMatch(venueOffer, /venue-club-deal-unavailable|No active Club Deal|Check back later/);
  assert.doesNotMatch(venueOffer, /clubDealQrSymbolMarkup|venue-detail-club-deal-symbol|venue-detail-club-deal-qr-state/);
  assert.doesNotMatch(venueOffer, /data-venue-profile-qr|Show venue QR|Venue QR/);
});

test("venue deal previews collapse without an active deal and adapt to one or multiple offers", () => {
  const venueOfferSource = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";
  const venueOfferMarkup = new Function(
    "encodeDealPass",
    "escapeHtml",
    "customerFacingDealDescription",
    `${venueOfferSource}; return venueOfferMarkup;`,
  )(
    () => "encoded-deal",
    (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    (value) => String(value || "").trim(),
  );

  assert.equal(venueOfferMarkup({ id: "venue-1", activeDeal: null }), "");

  const longTitle = "Complimentary priority admission for eligible guests arriving before the posted cutoff";
  const longDescription = "Present this offer in the dedicated deal experience and complete the authoritative cashier confirmation flow at the club.";
  const singleOffer = venueOfferMarkup({
    id: "venue-1",
    name: "Dynamic Club",
    activeDeal: { id: "deal-1", dealTitle: longTitle, dealDescription: longDescription },
    activeDeals: [{ id: "deal-1", dealTitle: longTitle, dealDescription: longDescription }],
  });
  assert.match(singleOffer, new RegExp(longTitle));
  assert.match(singleOffer, new RegExp(longDescription));
  assert.match(singleOffer, /data-club-deal-cta="encoded-deal"/);
  assert.match(singleOffer, />Club Deal</);
  assert.doesNotMatch(singleOffer, /clubDealQrSymbolMarkup|venue-detail-club-deal-symbol|<svg/i);

  const multipleOffers = venueOfferMarkup({
    id: "venue-1",
    name: "Dynamic Club",
    activeDeal: { id: "deal-1", dealTitle: "First", dealDescription: "First offer" },
    activeDeals: [
      { id: "deal-1", dealTitle: "First", dealDescription: "First offer" },
      { id: "deal-2", dealTitle: "Second", dealDescription: "Second offer" },
    ],
  });
  assert.match(multipleOffers, /2 Club Deals/);
  assert.match(multipleOffers, />Club Deals</);
});

test("venue profiles separate compact deal discovery from NFC redemption", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";

  assert.match(venueOffer, /venue-deal-preview-copy[\s\S]*?Active tonight[\s\S]*?venue-detail-club-deal-cta[\s\S]*?data-club-deal-cta="\$\{encodeDealPass\(config\)\}"/);
  assert.doesNotMatch(venueOffer, /NFC|cashier|clubDealQrSymbolMarkup|venue-detail-club-deal-qr-state/);
  assert.match(liveApp, /const dealPassTrigger = event\.target\.closest\("\[data-club-deal-cta\], \[data-deal-pass\]"\);[\s\S]*?await handleDealPassClick\(event\)/);
  assert.match(liveApp, /async function handleDealPassClick\(event\)[\s\S]*?event\.target\.closest\("\[data-club-deal-cta\]"\)[\s\S]*?createRevenueDealPass\(config\)[\s\S]*?openDealPassOverlay\(pass, revenueTrigger\)/);
  assert.match(aesthetic, /The club profile only previews an available deal[\s\S]*?\.venue-offer-card\.venue-deal-preview \{[\s\S]*?padding: 8px 10px !important;[\s\S]*?\.venue-detail-club-deal-cta \{[\s\S]*?min-height: 44px;/);
  assert.match(liveApp, /function openDealPassOverlay\(pass, triggerButton = null\)[\s\S]*?const overlay = dealPassOverlay\(\)[\s\S]*?overlay\.hidden = false[\s\S]*?overlay\.classList\.add\("show"\)/);
});

test("venue profile hierarchy stays compact and carries the restrained venue brand signature", () => {
  const refinement = aesthetic.match(/Production venue-detail refinement keeps one neutral frame[\s\S]*$/)?.[0] || "";

  assert.ok(refinement, "the final production venue-detail refinement must exist");
  assert.match(refinement, /\.venue-main-photo \{[\s\S]*?position: relative !important;[\s\S]*?min-height: clamp\(88px, 20vw, 104px\) !important;[\s\S]*?height: clamp\(88px, 20vw, 104px\) !important;/);
  assert.match(refinement, /\.venue-detail-logo-shell \{[\s\S]*?width: calc\(100% - clamp\(82px, 22vw, 112px\)\) !important;[\s\S]*?height: calc\(100% - 6px\) !important;[\s\S]*?max-height: 96px !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;/);
  assert.match(refinement, /\.venue-detail-logo \{[\s\S]*?position: absolute !important;[\s\S]*?inset: 0 !important;[\s\S]*?width: 100% !important;[\s\S]*?height: 100% !important;[\s\S]*?max-width: 100% !important;[\s\S]*?max-height: 100% !important;[\s\S]*?object-fit: contain !important;[\s\S]*?object-position: center center !important;/);
  assert.match(refinement, /\.venue-hero-brand-row \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: 36px minmax\(0, 1fr\) 36px;[\s\S]*?align-items: start;[\s\S]*?gap: 8px;[\s\S]*?padding: 6px 10px 0;/);
  assert.match(refinement, /\.venue-hero-brand-row \.venue-detail-logo-shell \{[\s\S]*?width: 100% !important;/);
  assert.match(refinement, /@media \(max-width: 650px\) \{[\s\S]*?\.venue-hero-brand-row \.venue-detail-logo-shell \{[\s\S]*?width: 100% !important;/);
  assert.match(refinement, /\.venue-hero-body \{[\s\S]*?display: grid !important;[\s\S]*?gap: 6px !important;[\s\S]*?padding: 8px 12px 10px !important;/);
  assert.match(refinement, /#venueDetailName \{[\s\S]*?color: var\(--dancr-color-brand-core\) !important;/);
  assert.match(refinement, /\.venue-identity-meta \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/);
  assert.match(refinement, /\.venue-identity-location \{[\s\S]*?display: inline-flex;[\s\S]*?gap: 5px;/);
  assert.match(refinement, /\.venue-status-grid \{[\s\S]*?position: relative;[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?gap: 0;[\s\S]*?border: 0;[\s\S]*?background: var\(--dancr-color-surface-subtle\);[\s\S]*?isolation: isolate;/);
  assert.doesNotMatch(refinement, /\.venue-status-grid::after/);
  assert.match(refinement, /:is\(\.venue-operating-summary, \.venue-quick-stat\) \{[\s\S]*?min-height: 70px !important;[\s\S]*?grid-template-rows: 12px 21px 12px;[\s\S]*?gap: 4px !important;[\s\S]*?padding: 9px 8px !important;/);
  assert.match(refinement, /\.venue-quick-stat \{[\s\S]*?min-height: 70px !important;[\s\S]*?padding: 9px 8px !important;[\s\S]*?-webkit-appearance: none;[\s\S]*?-webkit-tap-highlight-color: transparent;/);
  assert.match(refinement, /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?button\.venue-quick-stat:hover \{[\s\S]*?var\(--dancr-color-white-soft\)/);
  assert.match(refinement, /\.venue-quick-stat strong \{[\s\S]*?grid-row: 2 \/ 4;[\s\S]*?align-self: center;/);
  assert.match(refinement, /\.venue-quick-stat\.is-working strong \{[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(refinement, /\.venue-quick-stat\.is-working:not\(\.is-empty\) \{[\s\S]*?var\(--dancr-color-success\) 7%/);
  assert.match(refinement, /\.venue-quick-stat\.is-upcoming strong \{[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(refinement, /\.venue-quick-stat\.is-upcoming:not\(\.is-empty\) \{[\s\S]*?var\(--dancr-color-info\) 7%/);
  assert.match(refinement, /Hours remain neutral context[\s\S]*?\.venue-operating-summary \.venue-operating-status \{[\s\S]*?var\(--dancr-color-text-primary\)/);
  assert.match(refinement, /The club profile only previews an available deal[\s\S]*?\.venue-offer-card\.venue-deal-preview \{[\s\S]*?padding: 8px 10px !important;[\s\S]*?\.venue-deal-preview \.venue-offer-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto !important;[\s\S]*?\.venue-deal-preview-copy \{[\s\S]*?gap: 2px;/);
  assert.match(refinement, /\.venue-detail-club-deal-cta \{[\s\S]*?min-height: 44px;[\s\S]*?background: var\(--dancr-color-success\);/);
  assert.match(
    refinement,
    /\.venue-offer-card\.venue-deal-preview \{[\s\S]*?var\(--dancr-color-success\) 28%[\s\S]*?radial-gradient\(circle at 94% 0%, var\(--dancr-color-success-soft\), transparent 13rem\)[\s\S]*?var\(--dancr-color-success\) 5%[\s\S]*?0 10px 26px var\(--dancr-color-black-soft\)[\s\S]*?inset 0 1px 0 var\(--dancr-color-white-soft\)/,
  );
  assert.doesNotMatch(refinement.match(/\.venue-offer-card\.venue-deal-preview \{[\s\S]*?\n\}/)?.[0] || "", /0 0 18px|inset 0 0 0 1px/);
  assert.match(
    refinement,
    /\.venue-offer-card\.venue-deal-preview::before \{[\s\S]*?top: 12px;[\s\S]*?bottom: 12px;[\s\S]*?left: 0;[\s\S]*?width: 2px;[\s\S]*?background: var\(--dancr-color-success\);/,
  );
  assert.match(refinement, /\.venue-location-section \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?gap: 7px !important;/);
  assert.match(refinement, /\.venue-address-line \{[\s\S]*?min-height: 34px;[\s\S]*?padding: 7px 9px;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(refinement, /\.venue-address-directions \{[\s\S]*?min-height: 46px !important;/);
  assert.match(refinement, /\.venue-detail-uber \{[\s\S]*?min-height: 46px !important;/);
  assert.match(refinement, /\.venue-secondary-actions \.action-btn \{[\s\S]*?min-height: 44px !important;/);
  assert.match(refinement, /Club-detail action hierarchy[\s\S]*?\.venue-primary-actions > :is\(\.venue-address-directions, \.venue-detail-uber\) \{[\s\S]*?height: 44px !important;[\s\S]*?border-radius: 14px !important;[\s\S]*?rgba\(38, 39, 46, 0\.96\)[\s\S]*?inset 0 1px 0 rgba\(255, 255, 255, 0\.2\)[\s\S]*?blur\(16px\)/);
  assert.match(refinement, /Club-detail action hierarchy[\s\S]*?\.venue-secondary-actions \.action-btn \{[\s\S]*?height: 44px !important;[\s\S]*?border-radius: 13px !important;[\s\S]*?rgba\(24, 25, 30, 0\.88\)[\s\S]*?0 8px 18px rgba\(0, 0, 0, 0\.28\)/);
  assert.match(refinement, /\.venue-secondary-actions \.follow-venue-btn\.is-following \{[\s\S]*?var\(--dancr-color-brand-primary\) 12%/);
  assert.match(refinement, /\.venue-secondary-actions \.venue-detail-share\.is-confirmed \{[\s\S]*?var\(--dancr-color-success\) 6%/);
  assert.match(refinement, /\.venue-identity-block \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?align-items: start;[\s\S]*?gap: 0;/);
  assert.match(refinement, /\.venue-detail-close \{[\s\S]*?position: static !important;[\s\S]*?inset: auto !important;[\s\S]*?justify-self: end !important;[\s\S]*?width: 36px !important;[\s\S]*?height: 36px !important;[\s\S]*?display: inline-grid !important;[\s\S]*?place-items: center !important;[\s\S]*?border-radius: 50% !important;[\s\S]*?line-height: 0 !important;/);
  assert.match(refinement, /\.venue-detail-close \.icon \{[\s\S]*?width: 15px !important;[\s\S]*?height: 15px !important;[\s\S]*?stroke-width: 1\.85 !important;/);
  assert.match(refinement, /\.venue-detail-exploration \{[\s\S]*?display: grid;[\s\S]*?gap: 16px;[\s\S]*?padding: 10px 12px 16px;/);
  assert.match(refinement, /\.venue-activity-empty\.is-compact \{[\s\S]*?grid-template-columns: 34px minmax\(0, 1fr\);[\s\S]*?padding: 10px 11px;/);
  assert.match(refinement, /\.venue-hero \+ \.venue-detail-exploration \{[\s\S]*?margin-top: 0;/);
  assert.doesNotMatch(refinement, /\.venue-information-section|\.venue-contact-details-content/);
  assert.doesNotMatch(refinement, /\.venue-contact-link/);
  assert.doesNotMatch(refinement, /\.venue-contact-details summary|\.venue-contact-details\[open\]/);
  assert.match(refinement, /padding-bottom: max\(112px, calc\(94px \+ env\(safe-area-inset-bottom, 0px\)\)\) !important;/);
  assert.doesNotMatch(refinement, /home-bottom|home-nav-|global-mobile-bottom-nav|discoveryTabs/);
});

test("venue profile share action confirms success in the pressed button", () => {
  assert.match(liveApp, /function setVenueShareButtonState\(button, state\) \{[\s\S]*?classList\.contains\("venue-detail-share"\)[\s\S]*?is-confirmed[\s\S]*?Sharing\.\.\.[\s\S]*?Shared[\s\S]*?Share club/);
  assert.match(liveApp, /async function runVenueShareAction\(venueName, city = selectedCity\(\), trigger = null\) \{[\s\S]*?setVenueShareButtonState\(trigger, "sharing"\)[\s\S]*?await navigator\.share\(shareData\)[\s\S]*?setVenueShareButtonState\(trigger, "confirmed"\)[\s\S]*?showToast\("Club profile shared"\)/);
  assert.match(liveApp, /const copied = await copyText\(url, "Club link copied"\);[\s\S]*?setVenueShareButtonState\(trigger, copied \? "confirmed" : "idle"\)/);
  assert.match(liveApp, /void runVenueShareAction\([\s\S]*?venueButton\.dataset\.shareVenue,[\s\S]*?venueButton\.dataset\.shareCity \|\| selectedCity\(\),[\s\S]*?venueButton/);
  assert.match(aesthetic, /\.venue-secondary-actions \.venue-detail-share\.is-confirmed \{[\s\S]*?var\(--dancr-color-success-medium\)[\s\S]*?var\(--dancr-color-success\) 6%/);
});

test("venue profiles keep Working Now and Upcoming discoverable with truthful compact empty states", () => {
  const venueDetail = liveApp.match(/function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(venueDetail, /const quickStats = \[[\s\S]*?tonight\.length[\s\S]*?No dancers working now[\s\S]*?upcoming\.length[\s\S]*?No upcoming shifts[\s\S]*?\.join\(""\)/);
  assert.match(venueDetail, /venue-quick-stat is-working[\s\S]*?is-empty[\s\S]*?venue-quick-stat is-upcoming[\s\S]*?is-empty/);
  assert.match(venueDetail, /const activitySections = \[[\s\S]*?venue-activity-section is-working[\s\S]*?venue-activity-section is-upcoming[\s\S]*?venue-activity-section is-open/);
  assert.match(venueDetail, /venue-activity-section is-working[\s\S]*?No dancers working now[\s\S]*?Follow this club for updates\./);
  assert.match(venueDetail, /venue-activity-section is-upcoming[\s\S]*?No upcoming schedules[\s\S]*?No upcoming dancer dates are posted for this club\./);
  assert.doesNotMatch(venueDetail, /const activityMarkup =/);
  assert.doesNotMatch(venueDetail, /No active shifts now|No upcoming shifts posted|No trending profiles here yet/);
});

test("venue scroll cards remain separate from the deeper venue detail hierarchy", () => {
  const venueCard = liveApp.match(
    /function venueCard\(venue\) \{[\s\S]*?(?=\n    function venueDancers)/,
  )?.[0] || "";

  assert.ok(venueCard, "the venue scroll-card renderer must remain available");
  assert.doesNotMatch(venueCard, /venue-detail-exploration|venue-information-section|Venue information/);
  assert.match(venueCard, /venueExperienceHref\(venue, city\)/);
});

test("venue profiles stay full-screen with X dismissal and the shared floating navigation", () => {
  assert.match(
    liveApp,
    /<div class="venue-detail" role="dialog" aria-modal="true" aria-labelledby="venueDetailName">/,
  );
  assert.match(
    liveApp,
    /class="venue-hero-brand-row">[\s\S]*?class="venue-main-photo\$\{visual\.attrs\.className\}"[\s\S]*?class="close-btn venue-detail-close"[\s\S]*?data-close-venue-profile[\s\S]*?aria-label="Close \$\{details\.name\} club profile"[\s\S]*?<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"><\/path><path d="m6 6 12 12"><\/path><\/svg>[\s\S]*?class="venue-hero-body">/,
  );
  assert.doesNotMatch(
    liveApp,
    /class="venue-identity-block">[\s\S]*?class="close-btn venue-detail-close"/,
  );
  assert.match(
    liveApp,
    /#results\.venue-profile-overlay \{[\s\S]*?position: fixed !important;[\s\S]*?z-index: 140;[\s\S]*?height: 100dvh !important;[\s\S]*?overflow-y: auto !important;[\s\S]*?overflow-anchor: none !important;/,
  );
  assert.match(
    liveApp,
    /body\.profile-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs,\s*body\.venue-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs \{[\s\S]*?z-index: 210;[\s\S]*?visibility: visible !important;[\s\S]*?pointer-events: auto !important;/,
  );
  assert.match(
    liveApp,
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    liveApp,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?if \(profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?if \(nextTab === "venues" && activeTab === "venues" && selectedVenueName\) \{[\s\S]*?selectedVenueName = null;/,
  );
  assert.match(
    liveApp,
    /function closeVenueProfile\(\) \{[\s\S]*?selectedVenueName = null;[\s\S]*?item\.setAttribute\("aria-current", isActive \? "page" : "false"\);[\s\S]*?syncHomeDestinationLocation\("venues"\);[\s\S]*?render\(\);/,
  );
  assert.match(
    liveApp,
    /const venueProfileClose = event\.target\.closest\("\[data-close-venue-profile\]"\);[\s\S]*?closeVenueProfile\(\);/,
  );
  assert.match(
    liveApp,
    /function focusVenueProfileStart\(\{ showFocusRing = false \} = \{\}\) \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?toggleAttribute\("data-auto-focus", !showFocusRing\);[\s\S]*?focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close\[data-auto-focus\]:is\(:focus, :focus-visible\) \{[\s\S]*?outline: 0 !important;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close\[data-auto-focus\]:is\(:focus, :focus-visible\) \{[\s\S]*?border-color: rgba\(226, 232, 240, 0\.22\) !important;[\s\S]*?background: linear-gradient\(145deg, rgba\(49, 47, 59, 0\.96\), rgba\(19, 19, 25, 0\.94\)\) !important;[\s\S]*?0 8px 18px rgba\(0, 0, 0, 0\.36\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close:focus-visible:not\(\[data-auto-focus\]\) \{[\s\S]*?border-color: var\(--dancr-color-border\) !important;[\s\S]*?outline: 2px solid var\(--dancr-color-text-secondary\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close \{[\s\S]*?position: static !important;[\s\S]*?inset: auto !important;[\s\S]*?align-self: start !important;[\s\S]*?justify-self: end !important;[\s\S]*?width: 36px !important;[\s\S]*?height: 36px !important;[\s\S]*?min-height: 36px !important;/,
  );
  assert.doesNotMatch(
    liveApp,
    /venue-detail-modal-top/,
  );
});

test("venue entry points use the canonical in-app venue profile", () => {
  assert.match(
    liveApp,
    /function venueExperienceHref\(venue, city = selectedCity\(\)\)[\s\S]*?new URLSearchParams\(\{[\s\S]*?city: venueCity,[\s\S]*?venue: venueSlug[\s\S]*?return `\/\?\$\{query\.toString\(\)\}`/,
  );
  assert.match(
    liveApp,
    /function venueCard\(venue\)[\s\S]*?const city = citySelect\.value[\s\S]*?const venueHref = venueExperienceHref\(venue, city\)/,
  );
  assert.match(
    liveApp,
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\)[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?aria-label="Open \$\{safeName\}'s full club profile"/,
  );
  assert.match(
    liveApp,
    /const venueProfileLink = event\.target\.closest\("\[data-open-venue-profile\]"\);[\s\S]*?openVenueFromName\(venueProfileLink\.dataset\.openVenueProfile, \{ showFocusRing: event\.detail === 0 \}\);/,
  );
  assert.match(profileRoute, /permanentRedirect/);
});
