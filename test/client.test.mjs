import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { BoundaryError, openAICompatible } from '../src/index.mjs';
import { createGateway } from '../src/gateway.mjs';
import { completion, fixture, listen, closeServer } from './helpers.mjs';

const token = 'official-client-test-access-token';
async function setup(t, handler) {
  const upstream = await fixture(handler);
  t.after(() => upstream.close());
  const server = createGateway({ token, providers: {
    dot: openAICompatible({ baseURL: upstream.url, model: 'configured-model', apiKey: 'upstream-only-test-key' }),
  }, routes: { private: { destinations: ['dot'], allow: ['dot'] } } });
  const url = await listen(server);
  t.after(() => closeServer(server));
  return { upstream, url, client: new OpenAI({ apiKey: token, baseURL: `${url}/v1`, maxRetries: 0 }) };
}
test('official OpenAI client lists models and completes through gateway and upstream', async t => {
  const { client, upstream } = await setup(t);
  assert.equal((await client.models.list()).data[0].id, 'private');
  const result = await client.chat.completions.create({ model: 'private', messages: [{ role: 'user', content: 'Hello' }], temperature: 0.2 });
  assert.equal(result.choices[0].message.content, 'A complete answer.');
  assert.equal(upstream.requests[0].headers.authorization, 'Bearer upstream-only-test-key');
  assert.equal(upstream.requests[0].body.temperature, 0.2);
});
test('official OpenAI client consumes buffered SSE without partial response duplication', async t => {
  const { client } = await setup(t);
  const stream = await client.chat.completions.create({ model: 'private', messages: [{ role: 'user', content: 'Hello' }], stream: true });
  let answer = '', finishes = 0;
  for await (const chunk of stream) {
    answer += chunk.choices[0]?.delta.content || '';
    if (chunk.choices[0]?.finish_reason) finishes++;
  }
  assert.equal(answer, 'A complete answer.');
  assert.equal(finishes, 1);
});
test('official OpenAI client reads streamed function calls and typed policy errors', async t => {
  const { client } = await setup(t, (_, res) => res.end(JSON.stringify(completion(null, {
    choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [
      { id: 'call_one', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } },
    ] }, finish_reason: 'tool_calls' }],
  }))));
  const stream = await client.chat.completions.create({ model: 'private', messages: [{ role: 'user', content: 'Lookup' }], stream: true });
  const calls = [];
  for await (const chunk of stream) calls.push(...(chunk.choices[0]?.delta.tool_calls || []));
  assert.equal(calls[0].function.arguments, '{"id":1}');
  await assert.rejects(client.chat.completions.create({ model: 'unknown', messages: [] }), e => e.status === 400 && e.code === 'invalid_request');
});
