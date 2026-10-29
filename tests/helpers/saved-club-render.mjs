import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../../app/dashboard/CustomerDashboardPanels.tsx', import.meta.url), 'utf8');
const componentSource = source.slice(source.indexOf('function SavedVenueCard('), source.indexOf('function CustomerDirectionsButton('));
const require = createRequire(import.meta.url);

// Render the real isolated component. App services and Next routing stay stubbed.
export function savedClubFixture(overrides = {}, props = {}) {
  const destinations = [], directions = [], unfollows = [];
  const venue = { id: 'club-one', slug: 'test-club', name: 'Test Club', city: 'Las Vegas', state: 'NV',
    logoImageUrl: '/venue-logos/palomino-club.svg', imageUrl: '/never-use-this-photo.jpg', hoursLabel: '24 hours',
    activity: { workingNowCount: 0, workingDancers: [] }, ...overrides };
  const context = vm.createContext({ require, React, useState: React.useState, useRef: React.useRef,
    venueOperatingStatus: () => ({ state: 'open', label: 'Open' }),
    customerInitials: name => name.split(' ').map(part => part[0]).slice(0, 2).join(''),
    customerDancerHref: dancer => `/dancers/${dancer.id}`, customerVenueHref: club => `/venues/${club.slug}`,
    verifiedVenueLogoUrl: () => '', VenueCustomerSharing: () => null,
    Link: ({ prefetch: _prefetch, ...rest }) => React.createElement('a', rest),
    window: { getSelection: () => null, location: { origin: 'https://mydancr.com', assign: href => destinations.push(href) } },
  });
  vm.runInContext(ts.transpileModule(componentSource, { compilerOptions: {
    jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, context);
  const parameters = { venue, venueId: venue.id, entryDealId: 'entry-one', pending: false, removing: false,
    onDirections: club => directions.push(club.id), onUnfollow: () => unfollows.push(venue.id), ...props };
  return { destinations, directions, unfollows, venue, context,
    markup: () => renderToStaticMarkup(React.createElement(context.SavedVenueCard, parameters)),
    tree: () => context.SavedVenueCard(parameters),
  };
}
