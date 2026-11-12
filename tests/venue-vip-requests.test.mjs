import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import * as types from '../src/lib/dancr/vip-types.ts';

const request = { id: 'request-1', guest_name: 'Jordan', nickname: 'Friday regular', status: 'pending',
  starts_at: '2027-01-16T05:30:00Z', timezone: 'America/Los_Angeles',
  dancers: [{ id: 'dancer-1', stageName: 'Aria' }], notes: '', response_note: '' };

test('club review offers status actions without a custom message', () => {
  const reviews = [];
  const Cards = compileVip('app/vip/VipRequests.tsx', {
    '@/src/lib/dancr/vip-types': types,
    react: { useState: initial => [initial, () => {}] },
  }).default;
  function render(status = 'pending', busy = false) {
    const card = Cards({ requests: [{ ...request, status }], onReview: (...args) => reviews.push(args), busy }).props.children[0];
    return card.type(card.props);
  }
  function nodes(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : []; }
  for (const status of ['pending', 'confirmed', 'declined', 'cancelled']) {
    const tree = render(status);
    assert.doesNotMatch(renderToStaticMarkup(tree), /<textarea|Add message|Edit message|Message to VIP/);
    const buttons = nodes(tree).filter(node => node.type === 'button');
    const labels = status === 'pending' ? ['Confirm request', 'Decline'] : status === 'confirmed' ? ['Cancel confirmed request'] : [];
    assert.deepEqual(buttons.map(node => node.props.children), labels);
    for (const button of buttons) button.props.onClick();
    for (const button of nodes(render(status, true)).filter(node => node.type === 'button')) assert.equal(button.props.disabled, true);
  }
  assert.deepEqual(reviews, ['confirmed', 'declined', 'cancelled'].map(status =>
    [{ ...request, status: status === 'cancelled' ? 'confirmed' : 'pending' }, status]));
});

test('custom venue empty messages render while guest cards retain their own copy and hide private nicknames', () => {
  const Cards = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types }).default;
  const empty = renderToStaticMarkup(React.createElement(Cards, { requests: [], emptyMessage: 'No pending requests.', onReview() {} }));
  assert.match(empty, /No pending requests/); assert.doesNotMatch(empty, /No visit requests yet/);
  const guestEmpty = renderToStaticMarkup(React.createElement(Cards, { requests: [] }));
  assert.match(guestEmpty, /Your requests and club responses will appear here/);
  const guest = renderToStaticMarkup(React.createElement(Cards, { requests: [request], onEdit() {} }));
  assert.match(guest, /Edit request/); assert.doesNotMatch(guest, /Add message|Confirm request|Friday regular/);
});
