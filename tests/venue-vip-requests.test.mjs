import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import * as types from '../src/lib/dancr/vip-types.ts';

const request = { id: 'request-1', guest_name: 'Jordan', nickname: 'Friday regular', status: 'pending',
  starts_at: '2027-01-16T05:30:00Z', timezone: 'America/Los_Angeles',
  dancers: [{ id: 'dancer-1', stageName: 'Aria' }], notes: '', response_note: '' };

test('venue review messages start collapsed and edited notes reach the chosen review action', () => {
  const slots = [], reviews = []; let cursor = 0;
  const Cards = compileVip('app/vip/VipRequests.tsx', {
    '@/src/lib/dancr/vip-types': types,
    react: { useState(initial) { const i = cursor++; slots[i] ??= initial; return [slots[i], value => { slots[i] = value; }]; } },
  }).default;
  function render(status = 'pending', busy = false) {
    cursor = 0;
    const card = Cards({ requests: [{ ...request, status }], onReview: (...args) => reviews.push(args), busy }).props.children[0];
    return card.type(card.props);
  }
  function nodes(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : []; }
  let tree = render();
  const disclosure = nodes(tree).find(node => node.type === 'details');
  assert.equal(disclosure.props.open, undefined);
  assert.equal(nodes(disclosure).find(node => node.type === 'summary').props.children, 'Add message');
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'We look forward to seeing you.' } });
  tree = render();
  assert.equal(nodes(tree).find(node => node.type === 'summary').props.children, 'Edit message');
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'Confirm request').props.onClick();
  assert.equal(reviews[0][0].id, request.id); assert.equal(reviews[0][1], 'confirmed'); assert.equal(reviews[0][2], 'We look forward to seeing you.');
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'Decline').props.onClick();
  assert.equal(reviews[1][1], 'declined');
  tree = render('confirmed', true);
  assert.equal(nodes(tree).find(node => node.type === 'textarea').props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === 'button').props.disabled, true);
  tree = render('confirmed'); nodes(tree).find(node => node.type === 'button').props.onClick();
  assert.equal(reviews[2][1], 'cancelled');
  assert.equal(nodes(render('declined')).some(node => node.type === 'textarea'), false);
});

test('custom venue empty messages render while guest cards retain their own copy and hide private nicknames', () => {
  const Cards = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types }).default;
  const empty = renderToStaticMarkup(React.createElement(Cards, { requests: [], emptyMessage: 'No pending requests.', onReview() {} }));
  assert.match(empty, /No pending requests/); assert.doesNotMatch(empty, /No visit requests yet/);
  const guestEmpty = renderToStaticMarkup(React.createElement(Cards, { requests: [] }));
  assert.match(guestEmpty, /Your requests and venue responses will appear here/);
  const guest = renderToStaticMarkup(React.createElement(Cards, { requests: [request], onEdit() {} }));
  assert.match(guest, /Edit request/); assert.doesNotMatch(guest, /Add message|Confirm request|Friday regular/);
});
