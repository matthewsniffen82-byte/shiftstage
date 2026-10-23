import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { createMediaVisualResponse } from './helpers/media-visual-runtime.mjs';
import { photoContentRuntime } from './helpers/photo-content-runtime.mjs';
import { mediaIdentityRuntime } from './helpers/media-identity-runtime.mjs';

test('the installed SDK sends Astra Fast with strict output and no alternate model', async () => {
  const calls = [];
  const client = new OpenAI({ apiKey: 'synthetic', baseURL: 'https://synthetic.invalid/v1',
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://synthetic.invalid/v1/responses');
      calls.push(JSON.parse(init.body));
      return Response.json({ object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }] });
    } });
  const format = { type: 'json_schema', name: 'fixture', strict: true,
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
  const response = await createMediaVisualResponse(client, { input: 'fixture', text: { format } }, { maxRetries: 0 });
  assert.equal(response.output_text, '{"ok":true}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gpt-6-astra');
  assert.equal(calls[0].service_tier, 'fast');
  assert.equal(calls[0].store, false);
  assert.deepEqual(calls[0].reasoning, { effort: 'low' });
  assert.ok(calls[0].max_output_tokens >= 2000);
  for (const field of ['temperature', 'top_p', 'logprobs']) assert.equal(field in calls[0], false);
  assert.deepEqual(calls[0].text.format, format);
});

for (const status of [403, 429, 503]) test(`provider ${status} never falls back or certifies media`, async () => {
  let calls = 0;
  const create = async (request) => {
    calls++; assert.equal(request.model, 'gpt-6-astra'); assert.equal(request.service_tier, 'fast');
    throw Object.assign(new Error('Synthetic provider failure'), { status });
  };
  await assert.rejects(photoContentRuntime({ createResponse: create }).analyzeDancerPhotoContent({ buffer: Buffer.from('fixture'), contentType: 'image/jpeg' }), { status });
  await assert.rejects(mediaIdentityRuntime({ createResponse: create }).analyzeDancerMediaIdentity({ targetImages: [Buffer.from('fixture')], mediaType: 'photo' }), { status });
  assert.equal(calls, 2);
});
