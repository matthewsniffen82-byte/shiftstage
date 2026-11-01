import assert from 'node:assert/strict';
import test from 'node:test';
import { createZohoMailbox, parseZohoJson, processMailboxRetention, zohoMailboxConfig } from '../src/lib/dancr/zoho-mailbox.mjs';
const config = { clientId: 'fixture', clientSecret: 'fixture', refreshToken: 'fixture', accountId: '7153850000000008002', address: 'fixture@example.invalid' };
const mid = '1793405354839162800';
const caseId = '10000000-0000-4000-8000-000000000001';
const ok = data => Response.json({ status: { code: 200 }, data });
function provider(extra, account = config.address) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'fixture-access' });
    if (url.endsWith(config.accountId)) return ok({ accountId: config.accountId, primaryEmailAddress: account });
    if (url.endsWith('/folders')) return ok([{ folderId: '200', folderType: 'Trash' }]);
    return extra(url, options);
  };
  return { fetcher, calls };
}
test('19-digit provider IDs stay exact; configuration requires a complete server-only connection', () => {
  assert.equal(parseZohoJson('{"messageId":1793405354839162800}').messageId, mid);
  assert.equal(zohoMailboxConfig({}), null);
  assert.throws(() => zohoMailboxConfig({ ZOHO_MAIL_CLIENT_ID: 'x', ZOHO_MAIL_CLIENT_SECRET: 'x', ZOHO_MAIL_REFRESH_TOKEN: 'x', ZOHO_MAIL_ACCOUNT_ID: '../123', ZOHO_MAIL_ADDRESS: 'x' }), /Invalid mailbox/);
});
test('account identity mismatch and expired request budget fail before mailbox access', async () => {
  const p = provider(() => assert.fail('must not search'), 'other@example.invalid');
  await assert.rejects(createZohoMailbox(config, p.fetcher), /identity mismatch/);
  assert.equal(p.calls.length, 2);
  await assert.rejects(createZohoMailbox(config, p.fetcher, Date.now() - 1), /deadline/);
});
test('search includes sent/archive/spam/trash, disables grouping, preserves IDs and exhausts pagination', async () => {
  const p = provider(url => {
    const q = new URL(url).searchParams;
    assert.equal(q.get('searchKey'), `entire:"${caseId}"::inclspamtrash:true::groupResult:false`);
    assert.ok(Number(q.get('receivedTime')) > 0);
    return ok(q.get('start') === '1' ? Array.from({ length: 100 }, (_, n) => ({ messageId: String(1000 + n), folderId: '100' })) : [{ messageId: mid, folderId: '300', hasAttachment: true }]);
  });
  const mailbox = await createZohoMailbox(config, p.fetcher);
  const found = await mailbox.searchCase(caseId); assert.equal(found.length, 101); assert.equal(found.at(-1).messageId, mid); assert.ok(found.at(-1).hasAttachment);
  await assert.rejects(mailbox.searchCase('phrase"::in:all'), /Invalid case search/);
});
test('truncated or failed search cannot report absence', async () => {
  const p = provider(() => ok(Array.from({ length: 100 }, (_, n) => ({ messageId: String(n + 1), folderId: '100' }))));
  await assert.rejects((await createZohoMailbox(config, p.fetcher)).searchCase(caseId), /smaller reviewed scope/);
  const bad = provider(() => new Response('', { status: 404 }));
  await assert.rejects((await createZohoMailbox(config, bad.fetcher)).searchCase(caseId), /Provider unavailable/);
});
test('removal uses expunge=false and verifies Trash; never deletes from Trash or follows redirects', async () => {
  const p = provider((url, options) => {
    assert.equal(options.redirect, 'error');
    if (options.method === 'DELETE') { assert.equal(new URL(url).searchParams.get('expunge'), 'false'); return ok({}); }
    assert.ok(url.endsWith(`/folders/200/messages/${mid}/details`)); return ok({ messageId: mid, folderId: '200' });
  });
  const mailbox = await createZohoMailbox(config, p.fetcher);
  await mailbox.trash('100', mid);
  await assert.rejects(mailbox.trash('200', mid), /Never delete from Trash/);
  assert.equal(p.calls.filter(c => c.method === 'DELETE').length, 1);
});
test('provider success without verified removal is a failure', async () => {
  const p = provider((_url, options) => ok(options.method === 'DELETE' ? {} : { messageId: mid, folderId: '100' }));
  await assert.rejects((await createZohoMailbox(config, p.fetcher)).trash('100', mid), /not verified/);
});
test('permanent mailbox removal targets only the exact reviewed Trash message and requires complete search absence', async () => {
  const p = provider((url, options) => {
    if (options.method === 'DELETE') { assert.ok(url.endsWith(`/folders/200/messages/${mid}?expunge=true`)); return ok({}); }
    return ok([]);
  });
  await (await createZohoMailbox(config, p.fetcher)).removeFromTrash(mid, caseId);
  const stale = provider((_url, options) => ok(options.method === 'DELETE' ? {} : [{ messageId: mid, folderId: '200' }]));
  await assert.rejects((await createZohoMailbox(config, stale.fetcher)).removeFromTrash(mid, caseId), /Trash removal was not verified/);
});
function workerFixture({ copies = [{ messageId: mid, folderId: '100' }], checks = [true, true], failSearch = false, failReceipt = false } = {}) {
  let claimed = false, removed = 0, purged = 0; const receipts = [];
  const db = {
    async rpc(name, args) {
      if (name === 'claim_mailbox_retention') { if (claimed) return { data: null }; claimed = true; return { data: { id: 'job', lease_id: 'lease', source_id: caseId, search_phrase: caseId, source_table: 'content_reports', account_id: config.accountId, message_id: mid } }; }
      if (name === 'check_mailbox_retention_lease') return { data: checks.shift() };
      if (name === 'finish_mailbox_retention') { receipts.push(args); return { data: !failReceipt }; }
      assert.fail(name);
    },
    from() { const q = { select: () => q, eq: () => q, then: resolve => resolve({ data: [{ message_id: mid }] }) }; return q; },
  };
  const mailbox = { accountId: config.accountId, trashId: '200', searchCase: async () => { if (failSearch) throw new Error('provider'); return copies; },
    metadata: async () => ({ messageId: mid, folderId: copies[0].folderId }), trash: async () => { removed++; return { messageId: mid, folderId: '200' }; }, removeFromTrash: async () => { purged++; } };
  return { db, mailbox, receipts, removed: () => removed, purged: () => purged };
}
test('worker checks holds immediately before deletion and records copy-review failures', async () => {
  for (const options of [{ checks: [false] }, { checks: [true, false] }, { copies: [{ messageId: mid, folderId: '100' }, { messageId: '999', folderId: '100' }] }, { failSearch: true }]) {
    const f = workerFixture(options); const r = await processMailboxRetention(f.db, f.mailbox);
    assert.equal(f.removed(), 0); assert.equal(r.failed, 1);
    assert.equal(f.receipts[0].p_outcome, options.copies ? 'copy_review_required' : options.failSearch ? 'verification_failed' : 'case_review_required');
  }
});
test('restored messages are removed again; already trashed and absent messages are not deleted twice', async () => {
  for (const folder of ['100', '200', null]) {
    const f = workerFixture({ copies: folder ? [{ messageId: mid, folderId: folder }] : [] });
    const r = await processMailboxRetention(f.db, f.mailbox);
    assert.equal(f.removed(), folder === '100' ? 1 : 0);
    assert.equal(r.failed, 0); assert.equal(f.purged(), folder === '200' ? 1 : 0); assert.equal(f.receipts[0].p_outcome, folder === '200' ? 'trash_removed' : folder ? 'trashed' : 'absent');
  }
});
test('unsaved receipts fail the run; exhausted budgets do not claim work', async () => {
  const f = workerFixture({ failReceipt: true }); await assert.rejects(processMailboxRetention(f.db, f.mailbox), /receipt was not saved/);
  const fresh = workerFixture(); assert.equal((await processMailboxRetention(fresh.db, fresh.mailbox, 1)).trashed, 0); assert.equal(fresh.receipts.length, 0);
});
