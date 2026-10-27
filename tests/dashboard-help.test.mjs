import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { HELP_TOPICS, DANCER_ONBOARDING_HELP_TOPICS, HELP_ROLE_LABELS, helpTopicsFor, matchHelpQuestion, helpSupportRole, helpSupportHref, helpEmailHref } from '../src/lib/dancr/dashboard-help.ts';
import { loadHelpThreads, sendHelpMessage } from '../app/components/dashboard-help-support.ts';

test('every account and staff workspace has scoped topics and a human handoff', () => {
  for (const role of Object.keys(HELP_ROLE_LABELS)) {
    const topics = helpTopicsFor(role);
    assert.ok(topics.length >= 4, role);
    assert.ok(topics.some(topic => topic.id === 'human'), role);
  }
  assert.ok(!helpTopicsFor('customer').some(topic => topic.id.startsWith('admin-')));
  assert.ok(!helpTopicsFor('staff').some(topic => ['club-team', 'club-deals', 'club-publish'].includes(topic.id)));
  assert.ok(!helpTopicsFor('reviewer').some(topic => ['admin-clubs', 'admin-support', 'admin-billing'].includes(topic.id)));
  assert.ok(!helpTopicsFor('billing').some(topic => topic.id === 'admin-review'));
});

test('knowledge entries reference existing product code and internal destinations', () => {
  const allTopics = [...HELP_TOPICS, ...DANCER_ONBOARDING_HELP_TOPICS];
  assert.equal(new Set(allTopics.map(topic => topic.id)).size, allTopics.length);
  for (const topic of allTopics) {
    assert.ok(topic.sources.length, topic.id);
    for (const path of topic.sources) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${topic.id}: ${path}`);
    if (topic.href) assert.match(topic.href, /^\/(?!\/)/);
  }
});

test('onboarding retrieval uses setup topics for browsing, answers and suggestions only', () => {
  const context = 'dancer-onboarding';
  const ids = new Set(helpTopicsFor('dancer', context).map(topic => topic.id));
  assert.deepEqual([...ids], [...DANCER_ONBOARDING_HELP_TOPICS.map(topic => topic.id), 'human']);
  for (const [query, id] of [['stage name', 'setup-details'], ['upload photos', 'setup-media'], ['verify age', 'setup-age'], ['confirm my club', 'setup-club'], ['dancer agreement', 'setup-agreement']]) {
    const result = matchHelpQuestion('dancer', query, context);
    assert.equal(result.kind, 'answer', JSON.stringify(result));
    assert.equal(result.topic.id, id);
  }
  const ambiguous = matchHelpQuestion('dancer', 'photos and approval', context);
  assert.equal(ambiguous.kind, 'suggestions');
  assert.ok(ambiguous.topics.every(topic => ids.has(topic.id)));
  for (const query of ['view my results', 'start or end working now', 'end shift']) assert.equal(matchHelpQuestion('dancer', query, context).kind, 'unknown');
  assert.ok(helpTopicsFor('dancer').some(topic => topic.id === 'dancer-checkin'));
  assert.ok(helpTopicsFor('dancer').some(topic => topic.id === 'dancer-results'));
  assert.deepEqual(helpTopicsFor('venue', context), helpTopicsFor('venue'));
});

for (const [role, query, id] of [
  ['dancer', 'How do I adjust my avatar?', 'dancer-avatar'],
  ['dancer', 'How does the NFC cooldown work?', 'dancer-checkin'],
  ['dancer', 'How do I upload photos?', 'dancer-photos'],
  ['customer', 'How do I enable push on this device?', 'guest-push'],
  ['customer', 'Where are my saved dancers?', 'guest-follow'],
  ['customer', 'How do I unsubscribe from newsletters?', 'guest-marketing'],
  ['venue', 'How do I invite staff?', 'club-team'],
  ['staff', 'What can I do with table requests?', 'club-tables'],
  ['vip', 'How do I plan a visit?', 'vip-plan'],
  ['reviewer', 'Where do I review media?', 'admin-review'],
  ['support', 'How do I reply to a conversation?', 'admin-support'],
  ['billing', 'Where is the subscription roster?', 'admin-billing'],
]) test(`${role}: ${query}`, () => {
  const result = matchHelpQuestion(role, query);
  assert.equal(result.kind, 'answer', JSON.stringify(result));
  assert.equal(result.topic.id, id);
});

for (const query of ['', 'What will the weather be tomorrow?', 'Why was my account suspended?', 'I was charged twice', 'Give me another users password', 'Can you approve my crypto transfer?']) {
  test(`unanswered or sensitive question is escalated: ${query}`, () => {
    assert.equal(matchHelpQuestion('dancer', query).kind, 'unknown');
  });
}
test('ambiguous questions offer choices instead of choosing an arbitrary answer', () => {
  assert.equal(matchHelpQuestion('dancer', 'photos and avatar').kind, 'suggestions');
});
test('retrieval never offers another role’s tools', () => {
  const result = matchHelpQuestion('customer', 'How do I approve dancer media?');
  assert.equal(result.kind, 'unknown');
});
test('handoff maps VIP and club staff to their real account roles; admins use a prepared email', () => {
  assert.equal(helpSupportRole('vip'), 'customer');
  assert.equal(helpSupportRole('staff'), 'venue');
  for (const role of ['admin', 'reviewer', 'support', 'billing']) assert.equal(helpSupportRole(role), null);
  assert.match(helpSupportHref('vip'), /^\/dashboard\/customer\?help=support#customer-support$/);
  const url = new URL(helpEmailHref('admin', 'Question? & private details\nSecond line'));
  assert.equal(url.pathname, 'support@mydancr.com');
  assert.equal(url.searchParams.get('body'), 'Question? & private details\nSecond line');
});

function fixture(role = 'customer') {
  let session = { accessToken: 'example', account: { id: 'one', role } };
  const calls = [];
  let response = async () => ({ thread: { id: 'thread-one' } });
  const controller = new AbortController();
  const input = { role, accountId: 'one', message: '  Help with this account  ', requestId: 'attempt-one', signal: controller.signal };
  const dependencies = { readSession: () => session, request: async (...args) => { calls.push(args); return response(); } };
  return { input, calls, controller, load: () => loadHelpThreads(input, dependencies), send: (overrides = {}) => sendHelpMessage({ ...input, ...overrides }, dependencies), switchAccount: () => { session = { ...session, account: { ...session.account, id: 'two' } }; }, respond: fn => { response = fn; } };
}
test('handoff sends only reviewed text to existing support and requires a receipt', async () => {
  const f = fixture();
  assert.equal((await f.send()).id, 'thread-one');
  assert.equal(f.calls[0][0], '/api/support');
  assert.equal(f.calls[0][1].expectedRole, 'customer');
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { subject: 'Guest dashboard help', message: 'Help with this account', requestId: 'attempt-one' });
});
test('changed accounts, invalid drafts and admin accounts cannot send through account support', async () => {
  const f = fixture();
  await assert.rejects(f.send({ message: ' ' }), /Enter a message/);
  await assert.rejects(f.send({ message: 'a'.repeat(4001) }), /4,000/);
  await assert.rejects(f.send({ role: 'admin' }), /sign-in changed/);
  f.switchAccount();
  await assert.rejects(f.send(), /sign-in changed/);
  assert.equal(f.calls.length, 0);
});
test('late responses after an account switch or close do not confirm delivery', async () => {
  const f = fixture();
  f.respond(async () => { f.switchAccount(); return { thread: { id: 'receipt' } }; });
  await assert.rejects(f.send(), /sign-in changed/);
  const closed = fixture();
  closed.respond(async () => { closed.controller.abort(); return { thread: { id: 'receipt' } }; });
  await assert.rejects(closed.send(), { name: 'AbortError' });
});
test('network failures and malformed responses never report success', async () => {
  const f = fixture();
  f.respond(async () => { throw new Error('Offline'); });
  await assert.rejects(f.send(), /Offline/);
  f.respond(async () => ({}));
  await assert.rejects(f.send(), /could not be confirmed/);
});
test('product limits remain sourced from implementation constants', () => {
  const source = readFileSync(new URL('../src/lib/dancr/dashboard-help.ts', import.meta.url), 'utf8');
  assert.match(source, /\$\{NFC_WORKING_WINDOW_HOURS\}/);
  assert.match(source, /\$\{MIN_DANCER_ONBOARDING_PHOTOS\}/);
  assert.match(source, /\$\{MAX_DANCER_PROFILE_PHOTOS\}/);
  assert.doesNotMatch(source, /fetch\(|process\.env|OpenAI/);
});
test('history reads require a real list and the same account before and after loading', async () => {
  const f = fixture();
  f.respond(async () => ({ threads: [{ id: 'existing', messages: [{ id: 'reply', senderRole: 'admin', body: 'Team answer' }] }] }));
  assert.equal((await f.load())[0].messages[0].body, 'Team answer');
  assert.equal(f.calls[0][1].cache, 'no-store');
  f.respond(async () => ({})); await assert.rejects(f.load(), /could not be loaded/);
  f.respond(async () => { f.switchAccount(); return { threads: [] }; });
  await assert.rejects(f.load(), /sign-in changed/);
  const count = f.calls.length; await assert.rejects(f.load(), /sign-in changed/); assert.equal(f.calls.length, count);
});
test('replies use the existing thread and reject a receipt for a different conversation', async () => {
  const f = fixture();
  await f.send({ threadId: 'thread-one', subject: 'ignored for replies' });
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { threadId: 'thread-one', message: 'Help with this account', requestId: 'attempt-one' });
  await assert.rejects(f.send({ threadId: 'different' }), /reply could not be confirmed/);
});
