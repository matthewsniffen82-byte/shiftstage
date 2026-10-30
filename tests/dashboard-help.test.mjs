import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { HELP_TOPICS, DANCER_ONBOARDING_HELP_TOPICS, CLUB_APPROVAL_HELP_TOPICS, SECTION_HELP_TOPICS, HELP_ROLE_LABELS, helpTopicsFor, matchHelpQuestion, helpSupportRole, helpSupportHref, helpEmailHref } from '../src/lib/dancr/dashboard-help.ts';
import { HELP_SECTIONS, adminHelpContext, dancerSetupHelpContext } from '../src/lib/dancr/dashboard-help-context.ts';
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
  const allTopics = [...HELP_TOPICS, ...DANCER_ONBOARDING_HELP_TOPICS, ...CLUB_APPROVAL_HELP_TOPICS, ...SECTION_HELP_TOPICS];
  assert.equal(new Set(allTopics.map(topic => topic.id)).size, allTopics.length);
  for (const topic of allTopics) {
    assert.ok(topic.sources.length, topic.id);
    for (const path of topic.sources) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${topic.id}: ${path}`);
    if (topic.href) assert.match(topic.href, /^\/(?!\/)/);
  }
});

test('every scoped dashboard has reviewed topics and never exposes another section or role', () => {
  const catalog = [...HELP_TOPICS, ...DANCER_ONBOARDING_HELP_TOPICS, ...SECTION_HELP_TOPICS];
  for (const [context, section] of Object.entries(HELP_SECTIONS)) {
    for (const id of section.topics) assert.ok(catalog.some(topic => topic.id === id), `${context}: ${id}`);
    for (const role of Object.keys(HELP_ROLE_LABELS)) {
      const topics = helpTopicsFor(role, context);
      assert.equal(topics.at(-1).id, 'human');
      for (const topic of topics) {
        assert.ok(topic.roles.includes(role));
        assert.ok(topic.id === 'human' || section.topics.includes(topic.id));
        const result = matchHelpQuestion(role, topic.title, context);
        assert.equal(result.kind, 'answer', `${context}: ${topic.title}`);
        assert.equal(result.topic.id, topic.id);
      }
      for (const query of ['photos approval', 'email alerts', 'team permission', 'requests and account']) {
        const result = matchHelpQuestion(role, query, context);
        const matches = result.kind === 'answer' ? [result.topic] : result.kind === 'suggestions' ? result.topics : [];
        assert.ok(matches.every(topic => topics.includes(topic)), `${role}: ${context}`);
      }
    }
  }
});

test('setup and restricted roles cannot access operational guidance', () => {
  for (const context of ['setup-details', 'setup-media', 'setup-agreement', 'setup-age', 'setup-club', 'setup-account']) {
    assert.equal(matchHelpQuestion('dancer', 'view my results', context).kind, 'unknown');
  }
  assert.equal(matchHelpQuestion('vip', 'plan a VIP visit', 'vip-access').kind, 'unknown');
  assert.deepEqual(helpTopicsFor('staff', 'venue-media').map(topic => topic.id), ['human']);
  assert.deepEqual(helpTopicsFor('venue', 'venue-team-manager').map(topic => topic.id), ['club-team-manager', 'human']);
  assert.ok(!helpTopicsFor('venue', 'venue-setup-tools').some(topic => topic.id === 'club-website'));
  assert.equal(matchHelpQuestion('dancer', 'start working now', 'account-paused').kind, 'unknown');
});

test('admin help follows both workspace selection and staff permission boundaries', () => {
  for (const [workspace, review, club, tool, expected] of [
    ['home', '', '', '', 'admin-home'], ['approvals', 'media', '', '', 'admin-media'],
    ['approvals', 'profiles', '', '', 'admin-profiles'], ['approvals', 'reports', '', '', 'admin-reports'],
    ['clubs', '', 'directory', '', 'admin-clubs'], ['clubs', '', 'requests', '', 'admin-club-requests'],
    ['clubs', '', 'guests', '', 'admin-guests'], ['clubs', '', 'tools', '', 'admin-club-tools'],
    ['people', '', '', '', 'admin-people'], ['money', '', '', '', 'admin-money'],
    ['more', '', '', 'support', 'admin-support'], ['more', '', '', 'platform', 'admin-platform'],
    ['more', '', '', 'team', 'admin-team'], ['more', '', '', 'history', 'admin-history'],
  ]) {
    assert.equal(adminHelpContext('owner', workspace, review, club, tool), expected);
    for (const [role, scoped] of [['reviewer', 'admin-media'], ['support', 'admin-support'], ['billing', 'admin-money']]) {
      assert.equal(adminHelpContext(role, workspace, review, club, tool), scoped);
    }
  }
  assert.equal(dancerSetupHelpContext('dancer-profile-media', false), 'setup-details');
  assert.equal(dancerSetupHelpContext('dancer-profile-media', true), 'setup-agreement');
  assert.equal(dancerSetupHelpContext('dancer-onboarding-age', false), 'setup-age');
  assert.equal(dancerSetupHelpContext('dancer-onboarding-nfc', false), 'setup-club');
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

test('unapproved clubs only retrieve application topics, including typed questions and suggestions', () => {
  const context = 'venue-approval';
  const topics = helpTopicsFor('venue', context);
  assert.deepEqual(topics, CLUB_APPROVAL_HELP_TOPICS);
  for (const [query, id] of [
    ['check my club approval', 'club-application-status'],
    ['same account', 'club-application-login'],
    ['approval email', 'club-application-email'],
    ['correct details', 'club-application-changes'],
    ['contact support', 'club-application-support'],
  ]) {
    const result = matchHelpQuestion('venue', query, context);
    assert.equal(result.kind, 'answer', query);
    assert.equal(result.topic.id, id);
  }
  const ambiguous = matchHelpQuestion('venue', 'approval login', context);
  assert.equal(ambiguous.kind, 'suggestions');
  assert.ok(ambiguous.topics.every(topic => topics.includes(topic)));
  for (const query of ['invite staff', 'table requests', 'live roster', 'club deals', 'website grid', 'performance results', 'read the operating guides']) {
    assert.equal(matchHelpQuestion('venue', query, context).kind, 'unknown', query);
  }
  assert.ok(topics.every(topic => !topic.href), 'no links to locked dashboard sections');
  assert.ok(helpTopicsFor('venue').some(topic => topic.id === 'club-team'));
  assert.ok(!helpTopicsFor('venue').some(topic => topic.id.startsWith('club-application-')));
  for (const role of ['dancer', 'customer', 'staff', 'admin']) assert.deepEqual(helpTopicsFor(role, context), helpTopicsFor(role));
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
