import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
const venue = { id: 'club-1', name: 'Rhino & Co', slug: 'rhino', city: 'Las Vegas' };
const clubUrl = 'https://www.mydancr.com/?city=Las%20Vegas&venue=rhino';

// In-memory event handlers only: no browser journeys or live sharing.
function fixture({ native = true, cancelled = false, copied = true } = {}) {
  const nodes = new Map(), shares = [], copies = [], qr = [], events = [], toasts = [], states = [];
  let clickHandler;
  const document = { activeElement: null, getElementById: id => nodes.get(id) || null };
  function element() {
    const classes = new Set();
    return { dataset: {}, attributes: {}, hidden: true, isConnected: true,
      classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) },
      setAttribute(key, value) { this.attributes[key] = value; },
      focus() { document.activeElement = this; }, blur() { document.activeElement = null; },
    };
  }
  document.body = { insertAdjacentHTML() {
    const overlay = element(), children = new Map();
    for (const selector of ['.profile-qr-kicker', '[data-share-profile-choice]', '[data-copy-profile-choice]', '[data-show-profile-qr-choice]', '[data-close-profile-share-choice]']) children.set(selector, element());
    overlay.querySelector = selector => children.get(selector);
    overlay.contains = node => [...children.values()].includes(node);
    overlay.addEventListener = (name, callback) => { assert.equal(name, 'click'); clickHandler = callback; };
    nodes.set('profileShareChoiceOverlay', overlay);
    nodes.set('profileShareChoiceTitle', element()); nodes.set('profileShareChoiceSubtitle', element());
  } };
  const trigger = element();
  trigger.dataset = { shareVenue: venue.id, shareCity: venue.city };
  const context = vm.createContext({ document, URL,
    navigator: native ? { share: async data => { shares.push(JSON.parse(JSON.stringify(data))); if (cancelled) throw { name: 'AbortError' }; } } : {},
    window: { location: { origin: 'https://www.mydancr.com' } },
    selectedCity: () => 'Reno',
    resolveVenueByName: (reference, city) => city === venue.city && [venue.id, venue.name].includes(reference) ? venue : null,
    venueExperienceHref: (item, city) => `/?city=${encodeURIComponent(city)}&venue=${item.slug}`,
    actionButtonLabel: (icon, label) => `${icon}: ${label}`,
    copyText: async (url, message) => { copies.push({ url, message }); return copied; },
    showToast: message => toasts.push(message), syncOverlayScrollLock() {},
    setVenueShareButtonState: (button, state) => { assert.equal(button, trigger); states.push(state); },
    venueInteractionContext: button => { assert.equal(button, trigger); return { source: 'venue_scroll_card' }; },
    recordVenueInteraction: event => events.push(JSON.parse(JSON.stringify(event))),
    recordVenuePageEvent: event => events.push(JSON.parse(JSON.stringify(event))),
    recordLiveEvent() {}, recordUniqueTrendEvent() {}, recordProfileEngagementShare() {},
    profileShareUrl: (_name, _city, slug) => `https://www.mydancr.com/dancers/${slug || 'ty'}`,
    profileShareText: name => `See ${name} on MyDancr.`,
    openShareQrOverlay: options => qr.push(options),
  });
  for (const name of ['profileShareChoiceOverlay', 'openProfileShareChoice', 'openVenueShareChoice', 'closeProfileShareChoice', 'handleShareClick', 'runVenueShareAction', 'venueShareUrl', 'openVenueQrOverlay', 'openQrOverlay', 'runShareAction']) {
    const fn = source.match(new RegExp(`    (?:async )?function ${name}\\([\\s\\S]*?\\n    }`))?.[0];
    assert.ok(fn, name); vm.runInContext(fn, context);
  }
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { context, trigger, shares, copies, qr, events, states, toasts, nodes, document,
    overlay: () => nodes.get('profileShareChoiceOverlay'),
    openClub() { return context.handleShareClick({ target: { closest: selector => selector === '[data-share-venue]' ? trigger : null } }); },
    async click(selector) { clickHandler({ target: { closest: value => value === selector } }); await settle(); },
    async backdrop() { clickHandler({ target: Object.assign(this.overlay(), { closest: () => null }) }); await settle(); },
  };
}

test('club cards open the same menu as dancers before invoking phone sharing', () => {
  const f = fixture(); assert.equal(f.openClub(), true);
  assert.equal(f.overlay().hidden, false);
  assert.equal(f.overlay().attributes['aria-hidden'], 'false');
  assert.equal(f.trigger.attributes['aria-expanded'], 'true');
  assert.equal(f.nodes.get('profileShareChoiceTitle').textContent, 'Rhino & Co on MyDancr');
  assert.equal(f.overlay().querySelector('.profile-qr-kicker').textContent, 'Share club');
  assert.match(f.overlay().querySelector('[data-share-profile-choice]').innerHTML, /Share club/);
  assert.equal(f.overlay().querySelector('[data-copy-profile-choice]').textContent, 'Copy club link');
  assert.equal(f.shares.length + f.copies.length + f.qr.length, 0);
});

test('Share club opens the native sheet with the club URL and records completion', async () => {
  const f = fixture(); f.openClub(); await f.click('[data-share-profile-choice]');
  assert.equal(f.overlay().hidden, true);
  assert.deepEqual(f.shares, [{ title: 'Rhino & Co on MyDancr', text: 'See Rhino & Co on MyDancr.', url: clubUrl }]);
  assert.deepEqual(f.states, ['sharing', 'confirmed']);
  assert.deepEqual(f.events, [{ source: 'venue_scroll_card', venueId: venue.id, eventType: 'share_completed' }]);
});

test('Copy club link stays in the menu and copies only the public club page', async () => {
  const f = fixture(); f.openClub(); await f.click('[data-copy-profile-choice]');
  assert.deepEqual(f.copies, [{ url: clubUrl, message: 'Club link copied' }]);
  assert.equal(f.overlay().hidden, false); assert.equal(f.shares.length, 0);
  assert.equal(f.events[0].eventType, 'share_completed');
});

test('club QR opens the public club page and retains the original return button', async () => {
  const f = fixture(); f.openClub(); await f.click('[data-show-profile-qr-choice]');
  assert.equal(f.overlay().hidden, true); assert.equal(f.qr.length, 1);
  assert.equal(f.qr[0].url, clubUrl); assert.equal(f.qr[0].kind, 'venue');
  assert.equal(f.qr[0].openLabel, 'Open club'); assert.equal(f.qr[0].triggerButton, f.trigger);
  assert.equal(f.events[0].eventType, 'qr_impression'); assert.equal(f.shares.length, 0);
});

test('native cancellation and copy failure do not claim a completed share', async () => {
  const cancelled = fixture({ cancelled: true }); cancelled.openClub(); await cancelled.click('[data-share-profile-choice]');
  assert.deepEqual(cancelled.states, ['sharing', 'idle']); assert.equal(cancelled.events.length, 0); assert.equal(cancelled.toasts.length, 0);
  const failed = fixture({ copied: false }); failed.openClub(); await failed.click('[data-copy-profile-choice]');
  assert.equal(failed.events.length, 0); assert.deepEqual(failed.states, ['idle']);
  const fallback = fixture({ native: false }); fallback.openClub(); await fallback.click('[data-share-profile-choice]');
  assert.equal(fallback.copies[0].url, clubUrl); assert.equal(fallback.events[0].eventType, 'share_completed');
});

test('closing restores focus and reopening for a dancer clears all club choices and destinations', async () => {
  const f = fixture(); f.openClub(); await f.click('[data-close-profile-share-choice]');
  assert.equal(f.document.activeElement, f.trigger); assert.equal(f.trigger.attributes['aria-expanded'], 'false');
  assert.equal(f.overlay().dataset.venueReference, undefined);
  f.context.openProfileShareChoice('Ty', 'Las Vegas', f.trigger, 'ty-2');
  assert.equal(f.overlay().querySelector('.profile-qr-kicker').textContent, 'Share profile');
  assert.equal(f.overlay().querySelector('[data-copy-profile-choice]').textContent, 'Copy profile link');
  assert.equal(f.overlay().querySelector('[data-close-profile-share-choice]').attributes['aria-label'], 'Close profile sharing');
  await f.click('[data-copy-profile-choice]');
  assert.equal(f.copies[0].url, 'https://www.mydancr.com/dancers/ty-2');
  await f.click('[data-show-profile-qr-choice]');
  assert.equal(f.qr[0].kind, 'profile'); assert.equal(f.qr[0].url, 'https://www.mydancr.com/dancers/ty-2');
  assert.equal(f.events.length, 0);
  f.openClub(); await f.backdrop(); assert.equal(f.overlay().hidden, true);
});

test('an unavailable club cannot open a stale share destination', () => {
  const f = fixture(); f.trigger.dataset.shareVenue = 'missing'; f.openClub();
  assert.equal(f.overlay(), undefined); assert.deepEqual(f.toasts, ['Club profile unavailable']);
});
