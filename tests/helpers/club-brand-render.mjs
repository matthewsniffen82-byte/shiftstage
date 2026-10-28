import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sources = ['11-post-verified-shift', '19-reset-home-discovery-feed-qr-prompt', '08-save-customer-deal-pass', '02-record-live-event']
  .map(name => readFileSync(new URL(`../../src/live-shell/app/${name}.js`, import.meta.url), 'utf8')).join('\n');
export function clubBrandFixture(overrides = {}, profiles = []) {
  const venue = { id: 'club-one', slug: 'test-club', name: 'Test Club', city: 'Las Vegas', state: 'NV',
    address: '123 Main St, Las Vegas, NV', hours: '24 hours', logoImageUrl: '/venue-logos/palomino-club.svg',
    coverImageUrl: '/never-use-this-photo.jpg', activeDeal: { id: 'entry-one' }, ...overrides };
  const events = [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const context = vm.createContext({
    citySelect: { value: venue.city }, selectedCity: () => venue.city, stateByCity: {},
    venueDistanceLabel: () => '', displayShiftTime: value => value || '',
    parseClockMinutes: value => ({ '6 PM': 1080, '6 AM': 360 })[value.trim()] ?? null,
    cityWallClock: () => new Date('2026-10-28T12:00:00Z'),
    escapeHtml: escape, escapeOptionValue: escape,
    nativeResponsivePhotoAttrs: url => url ? `src="${escape(url)}"` : '',
    discoveryMarket: () => ({ venues: [venue], dancers: profiles, pagination: { scopeKey: JSON.stringify(['now', venue.id]), nextCursor: null } }),
    isApprovedPublicProfile: row => row.approved !== false, withTrendingRank: row => row,
    isWorkingTonight: row => row.working === true, dancerGridPosition: row => row.position || 0,
    isFollowingVenue: () => false, hasMoreDiscovery: () => false, liveDiscoveryIsLoading: () => false, liveMarketRefreshes: new Set(),
    publicAvatarPhotoUrl: row => row.photo || '', publicAvatarPhotoSrcSet: () => '', avatarPhotoPosition: () => '50% 50%',
    profileReferenceValue: row => row.id, venueExperienceHref: v => `/?venue=${v.slug}`,
    fictionalDemoVenueTravelAddress: () => '',
    actionButtonLabel: (icon, label) => `<span class="action-icon" data-action-icon="${icon}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 20V9l7-4 7 4v11M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span>${label}</span>`,
    encodeDealPass: value => escape(JSON.stringify(value)),
    freeEntryButtonLabel: () => '<span class="free-entry-label">Free Entry</span><span class="free-entry-cue" aria-hidden="true">›</span>',
    homeDancerGridCard: row => `<a data-grid-dancer="${row.id}" href="/dancers/${row.id}">${escape(row.name)}</a>`,
    discoveryRefreshButtonMarkup: () => '<button data-discovery-refresh aria-label="Refresh clubs">Refresh</button>',
    recordVenuePageEvent: event => events.push(event),
  });
  for (const name of ['venueDetails', 'venueOperatingStatus', 'venueInitials', 'venueLogoMarkup', 'venueLineupMarkup', 'venueCardQrMarkup', 'venueCard', 'venueDancers', 'venueDancerGridMarkup', 'venueRosterState', 'venueDetailPage', 'homeVenueDiscoveryQrMarkup', 'homeVenueDiscoveryFeedSlide', 'venueOfferMarkup', 'venueDirectionsMarkup']) {
    const start = sources.indexOf(`    function ${name}(`);
    if (start < 0) throw new Error(`Missing ${name}`);
    vm.runInContext(sources.slice(start, sources.indexOf('\n    }', start) + 6), context);
  }
  return { venue, events, context,
    card: () => context.venueCard(venue),
    feed: (index = 0) => context.homeVenueDiscoveryFeedSlide(venue, index, 10, venue.city),
    hero: () => context.venueDetailPage(venue),
  };
}
