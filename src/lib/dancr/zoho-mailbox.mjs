// Server callers only. Never expose provider payloads or credentials in logs or receipts.
const numericId = value => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[0-9]{1,24}$/.test(text)) throw new Error('Invalid mailbox reference');
  return text;
};
export function parseZohoJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number' || Number.isSafeInteger(value)) return value;
    if (context?.source && /^[0-9]{1,24}$/.test(context.source)) return context.source;
    throw new Error('Unsafe provider number');
  });
}
export function zohoMailboxConfig(env = process.env) {
  if (![env.ZOHO_MAIL_CLIENT_ID, env.ZOHO_MAIL_CLIENT_SECRET, env.ZOHO_MAIL_REFRESH_TOKEN, env.ZOHO_MAIL_ACCOUNT_ID, env.ZOHO_MAIL_ADDRESS].every(v => typeof v === 'string' && v.trim())) return null;
  return { clientId: env.ZOHO_MAIL_CLIENT_ID.trim(), clientSecret: env.ZOHO_MAIL_CLIENT_SECRET.trim(), refreshToken: env.ZOHO_MAIL_REFRESH_TOKEN.trim(),
    accountId: numericId(env.ZOHO_MAIL_ACCOUNT_ID.trim()), address: env.ZOHO_MAIL_ADDRESS.trim().toLowerCase() };
}
async function readJson(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider response missing');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Provider response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseZohoJson(new TextDecoder().decode(bytes));
}
export async function createZohoMailbox(config, fetcher = fetch, deadline = Date.now() + 45_000) {
  const signal = () => { if (Date.now() >= deadline) throw new Error('Mailbox request deadline reached'); return AbortSignal.timeout(Math.min(8000, deadline - Date.now())); };
  if (!config) throw new Error('Mailbox connection is not configured');
  const accountId = numericId(config.accountId);
  const token = await readJson(await fetcher('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: signal(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken }),
  }));
  if (typeof token.access_token !== 'string' || !token.access_token || token.error) throw new Error('Mailbox authorization failed');
  const base = `https://mail.zoho.com/api/accounts/${accountId}`;
  async function request(path, method = 'GET') {
    const result = await readJson(await fetcher(base + path, { method, redirect: 'error', cache: 'no-store', signal: signal(),
      headers: { Accept: 'application/json', Authorization: `Zoho-oauthtoken ${token.access_token}` } }));
    if (result.status?.code !== 200 || !Object.hasOwn(result, 'data')) throw new Error('Mailbox operation unconfirmed');
    return result.data;
  }
  // Fail closed if an environment value or token points to a different mailbox.
  const account = await request('');
  const primary = account.primaryEmailAddress || account.mailboxAddress;
  if (numericId(account.accountId) !== accountId || typeof primary !== 'string' || primary.toLowerCase() !== config.address) throw new Error('Mailbox identity mismatch');
  const folders = await request('/folders');
  if (!Array.isArray(folders)) throw new Error('Mailbox folders unavailable');
  const trash = folders.filter(f => f.folderType === 'Trash');
  if (trash.length !== 1) throw new Error('Trash folder is not uniquely identified');
  const trashId = numericId(trash[0].folderId);
  return {
    accountId, address: config.address, trashId,
    async searchCase(phrase) {
      if (typeof phrase !== 'string' || phrase.length < 8 || phrase.length > 150 || /["\r\n]/.test(phrase) || phrase.includes('::')) throw new Error('Invalid case search phrase');
      const found = new Map();
      for (let start = 1; start <= 301; start += 100) {
        const params = new URLSearchParams({ searchKey: `entire:"${phrase}"::inclspamtrash:true::groupResult:false`, start: String(start), limit: '100', receivedTime: String(Date.now()) });
        const rows = await request(`/messages/search?${params}`);
        if (!Array.isArray(rows)) throw new Error('Mailbox search unavailable');
        for (const row of rows) {
          const messageId = numericId(row.messageId), folderId = numericId(row.folderId);
          found.set(messageId, { messageId, folderId, subject: typeof row.subject === 'string' ? row.subject.slice(0, 250) : '',
            receivedAt: String(row.receivedTime || row.receivedtime || ''), hasAttachment: row.hasAttachment === 1 || row.hasAttachment === '1' || row.hasAttachment === true });
        }
        if (rows.length < 100) return [...found.values()];
      }
      // Never treat a truncated listing as an exhaustive copy search.
      throw new Error('Case mail search requires a smaller reviewed scope');
    },
    async metadata(folderId, messageId) {
      const data = await request(`/folders/${numericId(folderId)}/messages/${numericId(messageId)}/details`);
      if (numericId(data.messageId) !== messageId) throw new Error('Mailbox message mismatch');
      return { messageId, folderId: numericId(data.folderId) };
    },
    async trash(folderId, messageId) {
      if (numericId(folderId) === trashId) throw new Error('Never delete from Trash');
      await request(`/folders/${numericId(folderId)}/messages/${numericId(messageId)}?expunge=false`, 'DELETE');
      const actual = await this.metadata(trashId, messageId);
      if (actual.folderId !== trashId) throw new Error('Mailbox removal was not verified');
      return actual;
    },
    async removeFromTrash(messageId, phrase) {
      await request(`/folders/${trashId}/messages/${numericId(messageId)}?expunge=true`, 'DELETE');
      const remaining = await this.searchCase(phrase);
      if (remaining.some(m => m.messageId === messageId)) throw new Error('Trash removal was not verified');
    },
  };
}

export async function processMailboxRetention(db, mailbox, budgetMs = 40_000) {
  const counts = { trashed: 0, trash_removed: 0, absent: 0, failed: 0 }; const until = performance.now() + budgetMs;
  const rpc = async (name, args = {}) => { const r = await db.rpc(name, args); if (r.error) throw new Error('Mailbox ledger unavailable'); return r.data; };
  while (performance.now() + 18_000 < until) {
    const job = await rpc('claim_mailbox_retention', { p_account: mailbox.accountId });
    if (!job) break;
    let outcome = 'provider_unavailable', folder = null;
    try {
      if (job.account_id !== mailbox.accountId) throw new Error('Mailbox mismatch');
      const copies = await mailbox.searchCase(job.search_phrase);
      const approved = await db.from('mailbox_retention_jobs').select('message_id').eq('account_id', mailbox.accountId).eq('source_table', job.source_table).eq('source_id', job.source_id);
      if (approved.error || !Array.isArray(approved.data)) throw new Error('Copy review unavailable');
      const ids = new Set(approved.data.map(row => row.message_id));
      if (copies.some(row => !ids.has(row.messageId))) { outcome = 'copy_review_required'; throw new Error('Unreviewed case copies'); }
      const target = copies.find(row => row.messageId === job.message_id);
      if (!await rpc('check_mailbox_retention_lease', { p_id: job.id, p_lease: job.lease_id })) outcome = 'case_review_required';
      else if (!target) outcome = 'absent'; // Search absence, never an assertion of provider physical erasure.
      else {
        const metadata = await mailbox.metadata(target.folderId, target.messageId);
        if (!await rpc('check_mailbox_retention_lease', { p_id: job.id, p_lease: job.lease_id })) outcome = 'case_review_required';
        else {
          if (metadata.folderId === mailbox.trashId) {
            await mailbox.removeFromTrash(metadata.messageId, job.search_phrase);
            folder = mailbox.trashId; outcome = 'trash_removed';
          } else {
            const receipt = await mailbox.trash(metadata.folderId, metadata.messageId);
            folder = receipt.folderId; outcome = 'trashed';
          }
        }
      }
    } catch { if (outcome !== 'copy_review_required') outcome = 'verification_failed'; }
    if (!await rpc('finish_mailbox_retention', { p_id: job.id, p_lease: job.lease_id, p_outcome: outcome, p_folder: folder })) throw new Error('Mailbox receipt was not saved');
    if (outcome === 'trashed' || outcome === 'trash_removed' || outcome === 'absent') counts[outcome]++; else counts.failed++;
  }
  return counts;
}
